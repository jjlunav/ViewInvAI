import "./score-engine.js";
import "./goal-engine.js";
import "./market-session.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
  { cooldownDuration: 30000, cacheMaxAge: 3600000, timeoutDuration: 5000 }
);

// @cf/meta/llama-3.1-8b-instruct se retiró el 30/05/2026 (changelog de Workers AI): sus llamadas
// fallaban y el análisis caía en silencio al motor determinista (0 neuronas usadas).
const DEFAULT_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const FALLBACK_AI_MODELS = ["@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const RETIRED_AI_MODELS = new Set(["@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3.1-8b-instruct-awq"]);
const aiHealth = { lastOkAt: null, lastOkModel: "", lastErrorAt: null, lastError: "", lastErrorModel: "" };
function configuredAiModel(env) {
  const m = trimText(env.AI_MODEL || DEFAULT_AI_MODEL, 120) || DEFAULT_AI_MODEL;
  return RETIRED_AI_MODELS.has(m) ? DEFAULT_AI_MODEL : m;
}
// Catálogo vivo de Workers AI: los modelos se retiran (llama-3.1-8b-instruct el 30/05/2026 dejó
// el análisis sin IA en silencio). Una vez al día se consulta env.AI.models(), se descartan los
// retirados o con retirada próxima y se ordenan los candidatos; el preferido solo se usa si sigue
// vigente. Caché: memoria 6 h + KV 24 h (una escritura diaria).
const AI_CATALOG_KV_KEY = "ai-catalog:v1", AI_CATALOG_TTL_MS = 24 * 3600e3, AI_CATALOG_MEMO_MS = 6 * 3600e3;
const AI_RETIRE_MARGIN_MS = 14 * 864e5, AI_BAD_MODEL_MS = 6 * 3600e3;
let aiCatalogMemo = null, aiCatalogForce = false, aiCatalogLastForce = 0;
const aiBadModels = new Map();
function aiModelRetirement(m) {
  const props = Array.isArray(m && m.properties) ? m.properties : [];
  const tags = Array.isArray(m && m.tags) ? m.tags.map(t => String(t).toLowerCase()) : [];
  if (tags.some(t => t.includes("deprecat") || t.includes("retired"))) return 0;
  for (const p of props) {
    const id = String(p && p.property_id || "").toLowerCase();
    if (!id.includes("deprecat") && !id.includes("retire") && !id.includes("sunset")) continue;
    const v = String(p && p.value || "");
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
    if (/^(true|1|yes)$/i.test(v)) return 0;
  }
  return null;
}
function aiModelScore(name) {
  const n = String(name).toLowerCase();
  const fam = [
    // Coste primero (cuota gratuita de 10k neuronas/día): 8B ≈ 30 neuronas por análisis, Scout ≈ 60,
    // 70B ≈ 100. Los de 1-3B son baratos pero flojos para un JSON fiable.
    [/llama-3\.\d+-8b-instruct/, 100], [/llama-4-scout/, 92], [/llama.*70b.*instruct/, 86], [/llama.*instruct/, 70],
    [/mistral-small|mistral.*instruct/, 80], [/qwen.*(instruct|qwen3)/, 76], [/gemma-3/, 72], [/glm/, 68], [/gpt-oss/, 64]
  ].find(([re]) => re.test(n));
  const version = (n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
  const size = (n.match(/(\d+(?:\.\d+)?)b\b/) || [0, 0])[1] * 1;
  return (fam ? fam[1] : (/instruct|chat/.test(n) ? 50 : 30)) * 1000 + Math.min(version, 99) * 5 + (n.includes("fast") ? 3 : 0) - Math.min(size, 400) / 100;
}
function rankAiCatalog(list, now = Date.now()) {
  const names = [];
  for (const m of Array.isArray(list) ? list : []) {
    const name = String(m && m.name || "");
    if (!name.startsWith("@cf/")) continue;
    const task = String(m && m.task && m.task.name || "");
    if (task && !/text generation/i.test(task)) continue;
    if (/lora|awq|guard|embed|bge|vision|coder|math|whisper|-base\b|reward|sql|tts|stable-diffusion|flux/i.test(name)) continue;
    const retire = aiModelRetirement(m);
    if (retire !== null && retire - now < AI_RETIRE_MARGIN_MS) { RETIRED_AI_MODELS.add(name); continue; }
    names.push(name);
  }
  return [...new Set(names)].sort((a, b) => aiModelScore(b) - aiModelScore(a));
}
async function aiCatalog(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && aiCatalogMemo && now - aiCatalogMemo.at < AI_CATALOG_MEMO_MS) return aiCatalogMemo;
  if (!force && env.HOT_STATE_KV) {
    try {
      const cached = await env.HOT_STATE_KV.get(AI_CATALOG_KV_KEY, "json");
      if (cached && Array.isArray(cached.models) && now - Number(cached.at || 0) < AI_CATALOG_TTL_MS) {
        for (const r of cached.retired || []) RETIRED_AI_MODELS.add(r);
        return (aiCatalogMemo = cached);
      }
    } catch (_) {}
  }
  if (!env.AI || typeof env.AI.models !== "function") return aiCatalogMemo || { at: now, models: [], source: "none" };
  try {
    const list = await env.AI.models({ task: "Text Generation", hide_experimental: true, per_page: 100 });
    const valid = rankAiCatalog(list, now), models = valid.slice(0, 8);
    if (models.length) {
      aiCatalogMemo = { at: now, models, valid: valid.slice(0, 80), retired: [...RETIRED_AI_MODELS].slice(0, 60), source: "catalog" };
      if (env.HOT_STATE_KV) { try { await env.HOT_STATE_KV.put(AI_CATALOG_KV_KEY, JSON.stringify(aiCatalogMemo), { expirationTtl: 2 * 86400 }); } catch (_) {} }
      return aiCatalogMemo;
    }
  } catch (error) {
    console.warn("Workers AI catalog unavailable", String(error && error.message || error));
  }
  return aiCatalogMemo || { at: now, models: [], source: "none" };
}
// Ejecuta Workers AI con el primer modelo vigente: el preferido si no está retirado, luego los
// mejores del catálogo y, si el catálogo no responde, una lista fija. Un modelo que falla por
// retirado/no encontrado se aparta 6 h y fuerza refrescar el catálogo. Devuelve {result, model}.
async function runWorkersAi(env, input, preferred) {
  const force = aiCatalogForce && Date.now() - aiCatalogLastForce > 3600e3;
  if (force) { aiCatalogForce = false; aiCatalogLastForce = Date.now(); }
  const catalog = await aiCatalog(env, { force });
  const valid = new Set(catalog.valid || catalog.models || []), now = Date.now();
  const ok = m => m && !RETIRED_AI_MODELS.has(m) && !(aiBadModels.get(m) > now) && (!valid.size || valid.has(m));
  let models = [...new Set([preferred || configuredAiModel(env), ...(catalog.models || []), ...FALLBACK_AI_MODELS])].filter(ok).slice(0, 4);
  if (!models.length) models = FALLBACK_AI_MODELS.slice();
  let lastError = null;
  for (const model of models) {
    try {
      const result = await env.AI.run(model, input);
      aiHealth.lastOkAt = nowIso(); aiHealth.lastOkModel = model;
      return { result, model };
    } catch (error) {
      lastError = error;
      const msg = trimText(String(error && error.message || error), 240);
      aiHealth.lastErrorAt = nowIso(); aiHealth.lastErrorModel = model; aiHealth.lastError = msg;
      console.warn("Workers AI model failed", model, msg);
      if (/not found|no such model|unknown model|deprecat|retired|5007|invalid model/i.test(msg)) {
        aiBadModels.set(model, Date.now() + AI_BAD_MODEL_MS);
        aiCatalogForce = true;
      }
    }
  }
  throw lastError || new Error("Workers AI unavailable");
}
const GOAL_WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";
const GOAL_SCOUT_CACHE_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 32768;

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = "") {
  return prefix + crypto.randomUUID();
}

function trimText(value, max = 240) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function booleanInt(value) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Base de datos de caché (Turso / libSQL) para datos NO personales que se pueden regenerar:
// históricos de precios, tipos BCE y el marcador público del Radar. Así D1 queda para los datos
// del usuario y su cuota diaria no se agota por cachés. Imita la API de D1 (prepare/bind/first/
// all/run/raw/batch) sobre la API HTTP de Turso (/v2/pipeline). Sin secretos TURSO_URL y
// TURSO_TOKEN, o si Turso falla, todo vuelve a D1 automáticamente (pausa de 5 min tras un fallo).
// ---------------------------------------------------------------------------------------------
const CACHE_DB_RETRY_MS = 5 * 60000;
const cacheDbState = { adapter: null, url: "", failedUntil: 0, radarSyncPending: true, lastError: "", lastErrorAt: null, lastOkAt: null };
function tursoHttpUrl(raw) {
  const u = String(raw || "").trim().replace(/^libsql:\/\//i, "https://").replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+$/i.test(u) ? u : "";
}
function tursoArg(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  if (typeof v === "number") return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  if (typeof v === "bigint") return { type: "integer", value: v.toString() };
  return { type: "text", value: String(v) };
}
function tursoValue(c) {
  if (!c || c.type === "null") return null;
  if (c.type === "integer") return Number(c.value);
  if (c.type === "float") return Number(c.value);
  return c.value;
}
function tursoAdapter(baseUrl, token) {
  async function pipeline(stmts) {
    const requests = stmts.map(s => ({ type: "execute", stmt: { sql: s.sql, args: s.args.map(tursoArg) } }));
    requests.push({ type: "close" });
    const res = await fetch(baseUrl + "/v2/pipeline", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error("Turso HTTP " + res.status);
    const data = await res.json();
    return (data.results || []).slice(0, stmts.length).map(r => {
      if (!r || r.type !== "ok") throw new Error("Turso: " + trimText(r && r.error && r.error.message || "error", 200));
      const out = r.response && r.response.result || {};
      const cols = (out.cols || []).map(c => c.name);
      const rows = (out.rows || []).map(row => Object.fromEntries(cols.map((name, i) => [name, tursoValue(row[i])])));
      return { results: rows, success: true, cols, rawRows: (out.rows || []).map(row => row.map(tursoValue)),
        meta: { changes: Number(out.affected_row_count) || 0, rows_written: Number(out.rows_written) || 0, rows_read: Number(out.rows_read) || 0, last_row_id: out.last_insert_rowid ? Number(out.last_insert_rowid) : null } };
    });
  }
  const statement = (sql, args = []) => ({
    sql, args, __turso: true,
    bind: (...a) => statement(sql, a),
    all: async () => (await pipeline([{ sql, args }]))[0],
    run: async () => (await pipeline([{ sql, args }]))[0],
    first: async col => { const r = (await pipeline([{ sql, args }]))[0].results[0]; return r === undefined ? null : col ? (r[col] ?? null) : r; },
    raw: async () => (await pipeline([{ sql, args }]))[0].rawRows
  });
  return { label: "turso", prepare: sql => statement(sql), batch: async list => list.length ? pipeline(list.map(s => ({ sql: s.sql, args: s.args || [] }))) : [] };
}
// Envuelve el adaptador: si una llamada a Turso falla, la repite en D1 y pausa Turso unos minutos.
function cacheDb(env) {
  const url = tursoHttpUrl(env.TURSO_URL), token = String(env.TURSO_TOKEN || "").trim();
  if (!url || !token || !env.DB || Date.now() < cacheDbState.failedUntil) return env.DB;
  const key = url + "#" + token.length + ":" + token.slice(-6);
  if (!cacheDbState.adapter || cacheDbState.url !== key) { cacheDbState.adapter = tursoAdapter(url, token); cacheDbState.url = key; }
  return cacheDbState.adapter;
}
function cacheDbLabel(db) { return db && db.label === "turso" ? "turso" : "d1"; }
function noteCacheDbFailure(error) {
  cacheDbState.failedUntil = Date.now() + CACHE_DB_RETRY_MS;
  cacheDbState.radarSyncPending = true; // lo escrito en D1 durante la caída se sincroniza al volver
  cacheDbState.lastError = trimText(String(error && error.message || error), 240);
  cacheDbState.lastErrorAt = nowIso();
  console.warn("Turso cache DB failed; falling back to D1", cacheDbState.lastError);
}
// Ejecuta fn(db) en la base de caché; si Turso falla, la repite en D1.
async function withCacheDb(env, fn) {
  const db = cacheDb(env);
  if (cacheDbLabel(db) !== "turso") return fn(env.DB);
  try { const out = await fn(db); cacheDbState.lastOkAt = nowIso(); return out; }
  catch (error) { noteCacheDbFailure(error); return fn(env.DB); }
}
const cacheSchemaReady = new Set();
async function ensureCacheSchema(db, name, statements) {
  const key = name + ":" + cacheDbLabel(db);
  if (cacheSchemaReady.has(key)) return;
  await db.batch(statements.map(sql => db.prepare(sql)));
  cacheSchemaReady.add(key);
}
async function cacheDbStatus(env, url) {
  const out = { configured: !!(tursoHttpUrl(env.TURSO_URL) && String(env.TURSO_TOKEN || "").trim()), active: cacheDbLabel(cacheDb(env)),
    lastOkAt: cacheDbState.lastOkAt, lastErrorAt: cacheDbState.lastErrorAt, lastError: cacheDbState.lastError,
    pausedUntil: cacheDbState.failedUntil > Date.now() ? new Date(cacheDbState.failedUntil).toISOString() : null };
  if (url.searchParams.get("probe") !== "turso" || !out.configured) return out;
  const t0 = Date.now();
  try {
    const db = tursoAdapter(tursoHttpUrl(env.TURSO_URL), String(env.TURSO_TOKEN).trim());
    const [one, tables] = await db.batch([db.prepare("SELECT 1 AS ok"), db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]);
    out.probe = { ok: one.results[0] && one.results[0].ok === 1, ms: Date.now() - t0, tables: tables.results.map(r => r.name).slice(0, 40) };
    cacheDbState.lastOkAt = nowIso();
  } catch (error) {
    out.probe = { ok: false, ms: Date.now() - t0, error: trimText(String(error && error.message || error), 240) };
  }
  return out;
}

const AUTO_WRITE_BUDGET_LIMIT = 60000;
const AUTO_WRITE_COST_FACTOR = 3;
function madridDayKey(ms=Date.now()){
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
}
function scheduledAnalysisWindow(target,nowMs=Date.now()){
  const api=globalThis.ViewInvAIMarketSession;
  if(!api)return true;
  if(Number(target&&target.prefer_tr)===1){
    const p=api.zoneClock("Europe/Berlin",new Date(nowMs));
    return api.lsxOpen(p);
  }
  const p=api.zoneClock("America/New_York",new Date(nowMs));
  return api.usSession(p)!=="previous";
}
let automationBudgetSchemaReady=false;
async function ensureAutomationWriteBudgetSchema(env){
  if(automationBudgetSchemaReady)return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS automation_write_budget (day TEXT PRIMARY KEY,estimated_rows INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)"
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_automation_write_budget_updated ON automation_write_budget(updated_at DESC)").run();
  automationBudgetSchemaReady=true;
}
async function automationWriteBudget(env,nowMs=Date.now()){
  const p=madridDayKey(nowMs),day=p.year+"-"+p.month+"-"+p.day;
  try{
    await ensureAutomationWriteBudgetSchema(env);
    const row=await env.DB.prepare("SELECT estimated_rows FROM automation_write_budget WHERE day=?").bind(day).first();
    const estimated=Math.max(0,Number(row&&row.estimated_rows)||0);
    return{day,estimated,paused:estimated>=AUTO_WRITE_BUDGET_LIMIT};
  }catch(error){
    console.warn("Automation write budget unavailable",String(error&&error.message||error));
    return{day,estimated:0,paused:false};
  }
}
async function recordAutomationWrites(env,budget,logicalWrites){
  const n=Math.max(0,Math.ceil(Number(logicalWrites)||0));
  if(!n)return;
  const estimated=n*AUTO_WRITE_COST_FACTOR+1,now=nowIso();
  try{
    await env.DB.prepare(
      "INSERT INTO automation_write_budget (day,estimated_rows,updated_at) VALUES (?,?,?) "+
      "ON CONFLICT(day) DO UPDATE SET estimated_rows=automation_write_budget.estimated_rows+excluded.estimated_rows,updated_at=excluded.updated_at"
    ).bind(budget.day,estimated,now).run();
  }catch(error){console.warn("Automation write budget update failed",String(error&&error.message||error))}
}

let fcmAccessCache = null;

function base64UrlBytes(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlText(value) {
  return base64UrlBytes(new TextEncoder().encode(String(value)));
}

function fcmServiceAccount(env) {
  const raw = String(env.FCM_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

async function importGooglePrivateKey(pem) {
  const clean = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function fcmAccessToken(env) {
  const account = fcmServiceAccount(env);
  if (!account) return null;
  if (fcmAccessCache && fcmAccessCache.clientEmail === account.client_email && Date.now() < fcmAccessCache.expiresAt - 60000) {
    return { token: fcmAccessCache.token, projectId: account.project_id };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlText(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claim;
  const key = await importGooglePrivateKey(account.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + base64UrlBytes(signature);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("FCM OAuth " + response.status);
  const data = await response.json();
  const token = String(data.access_token || "");
  if (!token) throw new Error("FCM OAuth returned no token");
  fcmAccessCache = {
    clientEmail: account.client_email,
    token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 3600) * 1000
  };
  return { token, projectId: account.project_id };
}

async function sendFcmToDevice(env, auth, device, alert, target) {
  const data={
    alertId:String(alert.id||""),
    stockKey:String(target.stock_key||""),
    ticker:String(target.ticker||""),
    preferTr:Number(target.prefer_tr)===1?"1":"0",
    alertType:String(alert.alert_type||""),
    severity:String(alert.severity||""),
    route:String(target.route||""),
    portfolioId:String(target.portfolio_id||target.portfolioId||""),
    title:String(alert.title||"ViewInvAI"),
    body:String(alert.message||"")
  };
  const isWeb=String(device&&device.platform||"").toLowerCase()==="web";
  const message=isWeb
    ?{token:device.push_token,data,webpush:{headers:{Urgency:alert.severity==="critical"||alert.severity==="high"?"high":"normal"}}}
    :{
      token:device.push_token,
      notification:{title:alert.title,body:alert.message},
      data,
      android:{
        priority:alert.severity==="critical"||alert.severity==="high"?"high":"normal",
        notification:{channel_id:"viewinvai_market_alerts",sound:"default"}
      }
    };
  const response = await fetch(
    "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(auth.projectId) + "/messages:send",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + auth.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({message})
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = String(payload && payload.error && payload.error.status || "");
    const details = JSON.stringify(payload && payload.error || {});
    // Only a dead registration token may disable a device. A malformed payload also answers INVALID_ARGUMENT and must not wipe every user's devices.
    const invalid = status === "NOT_FOUND" || /UNREGISTERED|registration-token-not-registered/i.test(details) ||
      (status === "INVALID_ARGUMENT" && /registration token|not a valid FCM/i.test(details));
    if (invalid) {
      await env.DB.prepare("UPDATE devices SET enabled=0,updated_at=? WHERE id=?").bind(nowIso(), device.id).run();
    }
    throw new Error("FCM send " + response.status + (status ? " " + status : ""));
  }
  return true;
}

async function dispatchPushAlert(env, alert, target) {
  if (!env.DB) return { configured: false, sent: 0 };
  const globalNotifications = await globalNotificationSettingsForUser(env, target.user_id);
  if (!globalNotifications.enabled) return { configured: true, sent: 0, disabled: true };
  let auth=null;
  try{auth=await fcmAccessToken(env)}
  catch(error){
    console.warn("FCM authentication failed",String(error&&error.message||error));
    return {configured:true,sent:0,error:"fcm-auth-failed"};
  }
  if (!auth) return { configured: false, sent: 0 };

  const rows = await env.DB.prepare(
    "SELECT id,push_token,platform FROM devices WHERE user_id=? AND enabled=1 ORDER BY last_seen_at DESC LIMIT 20"
  ).bind(target.user_id).all();
  const devices = rows.results || [];
  if (!devices.length) return { configured: true, sent: 0 };

  const settled = await Promise.allSettled(devices.map(device => sendFcmToDevice(env, auth, device, alert, target)));
  const sent = settled.filter(x => x.status === "fulfilled").length;
  if (sent > 0) {
    await env.DB.prepare("UPDATE alert_events SET pushed_at=? WHERE id=?").bind(nowIso(), alert.id).run();
  }
  for (const row of settled) {
    if (row.status === "rejected") console.warn("FCM device send failed", String(row.reason && row.reason.message || row.reason));
  }
  return { configured: true, sent };
}

function defaultJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function apiGuard(request) {
  const allowed = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  if (!allowed.has(request.method)) return { status: 405, error: "Method not allowed" };
  const url = new URL(request.url);
  const origin = String(request.headers.get("Origin") || "");
  const nativeOrigin = ["https://localhost","http://localhost","capacitor://localhost","ionic://localhost"].includes(origin.toLowerCase());
  if (origin && origin !== url.origin && !nativeOrigin) return { status: 403, error: "Forbidden" };
  const site = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  if (!nativeOrigin && site && !["same-origin", "none"].includes(site)) return { status: 403, error: "Forbidden" };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const type = String(request.headers.get("Content-Type") || "").toLowerCase();
    if (request.method !== "DELETE" && type && !type.startsWith("application/json")) {
      return { status: 415, error: "Content-Type must be application/json" };
    }
  }
  return null;
}

async function readJson(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) throw new Error("Payload too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Payload too large");
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON object");
  return parsed;
}

// Registro del usuario como mucho cada 10 minutos por instancia (antes: dos escrituras en
// cada petición). Los datos de perfil cambian muy poco.
const SEEN_USERS=new Map();
async function verifyFirebaseUser(request, env) {
  if (!env.DB) return { error: "D1 backend not configured", status: 503 };
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) return { error: "Firebase authentication not configured", status: 503 };

  const auth = String(request.headers.get("Authorization") || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: "Authentication required", status: 401 };

  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      algorithms: ["RS256"],
      issuer: "https://securetoken.google.com/" + projectId,
      audience: projectId,
      clockTolerance: 60
    }));
  } catch (error) {
    const code = String(error && error.code || "");
    console.warn("Firebase token verification failed", code, String(error && error.message || error));
    // Sin poder descargar las claves de Google no se sabe si el token es válido: es un fallo
    // temporal (503) y la app reintenta; solo un token realmente inválido devuelve 401.
    if (/JWKS_TIMEOUT|JWKS_INVALID|ERR_JWKS|ERR_JOSE_GENERIC/.test(code) || /fetch|network|timeout/i.test(String(error && error.message || "")))
      return { error: "Authentication service temporarily unavailable", status: 503 };
    return { error: "Invalid or expired authentication token", status: 401 };
  }

  const userId = trimText(payload.sub, 128);
  const email = trimText(payload.email, 320).toLowerCase();
  if (!userId || !email || payload.email_verified !== true) {
    return { error: "Verified Google/Firebase account required", status: 401 };
  }
  const displayName = trimText(payload.name || payload.display_name || email.split("@")[0], 120);
  const avatarUrl = trimText(payload.picture, 600);
  const signature = email + "|" + displayName + "|" + avatarUrl, seen = SEEN_USERS.get(userId);
  if (!seen || seen.signature !== signature || Date.now() - seen.at > 10 * 60000) {
    try {
      const now = nowIso();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users (id,email,display_name,avatar_url,auth_provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?) " +
          "ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,avatar_url=excluded.avatar_url,updated_at=excluded.updated_at"
        ).bind(userId, email, displayName, avatarUrl, "firebase-google", now, now),
        env.DB.prepare("INSERT INTO user_settings (user_id,created_at,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING").bind(userId, now, now)
      ]);
      SEEN_USERS.set(userId, { at: Date.now(), signature });
      if (SEEN_USERS.size > 5000) SEEN_USERS.clear();
    } catch (error) {
      console.warn("User upsert failed", String(error && error.message || error));
      // Si el usuario ya existía, se puede seguir; si es nuevo, la petición se reintentará.
      if (!seen) return { error: "Database temporarily unavailable", status: 503 };
    }
  }
  return { user: { id: userId, email, displayName, avatarUrl } };
}

let positionBrokerSchemaReady=false;
async function ensurePositionBrokerSchema(env){
  if(positionBrokerSchemaReady)return;
  const cols=await env.DB.prepare("PRAGMA table_info(positions)").all();
  const names=new Set((cols.results||[]).map(row=>String(row.name||"")));
  if(!names.has("broker"))await env.DB.prepare("ALTER TABLE positions ADD COLUMN broker TEXT NOT NULL DEFAULT ''").run();
  if(!names.has("cost_basis"))await env.DB.prepare("ALTER TABLE positions ADD COLUMN cost_basis REAL").run();
  if(!names.has("fees_total"))await env.DB.prepare("ALTER TABLE positions ADD COLUMN fees_total REAL NOT NULL DEFAULT 0").run();
  // Acciones congeladas: cantidad que el Objetivo no puede tocar hasta frozen_until (inclusive).
  if(!names.has("frozen_qty"))await env.DB.prepare("ALTER TABLE positions ADD COLUMN frozen_qty REAL NOT NULL DEFAULT 0").run();
  if(!names.has("frozen_until"))await env.DB.prepare("ALTER TABLE positions ADD COLUMN frozen_until TEXT").run();
  await env.DB.prepare("DROP INDEX IF EXISTS idx_positions_portfolio_stock").run();
  await env.DB.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_portfolio_identity ON positions(portfolio_id,stock_key,broker,currency,prefer_tr,exchange)"
  ).run();
  positionBrokerSchemaReady=true;
}

// Congelación vigente: la fecha es la del calendario del usuario (inclusive). El servidor va en UTC,
// así que da un día de margen (UTC de ayer): nunca descongela antes de que acabe el día del usuario.
function serverFreezeFloorDate(){return new Date(Date.now()-86400000).toISOString().slice(0,10)}
function serverFrozenQty(p){
  const until=String(p&&p.frozen_until||"").slice(0,10),qty=finiteNumber(p&&p.frozen_qty)??0;
  if(!until||!(qty>0)||until<serverFreezeFloorDate())return 0;
  return Math.min(qty,Math.max(0,finiteNumber(p.quantity)??qty));
}

let portfolioMarketSchemaReady=false;
async function ensurePortfolioMarketSchema(env){
  if(portfolioMarketSchemaReady)return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS portfolio_market_settings ("+
    "portfolio_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,market_scope TEXT NOT NULL DEFAULT 'auto',cash_balance REAL NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,"+
    "FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  const marketColumns=await env.DB.prepare("PRAGMA table_info(portfolio_market_settings)").all();
  if(!(marketColumns.results||[]).some(row=>String(row.name||"")==="cash_balance")){
    await env.DB.prepare("ALTER TABLE portfolio_market_settings ADD COLUMN cash_balance REAL NOT NULL DEFAULT 0").run();
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_portfolio_market_settings_user ON portfolio_market_settings(user_id,updated_at DESC)").run();
  portfolioMarketSchemaReady=true;
}
function normalizedMarketScope(value){
  const scope=String(value||"auto").trim().toLowerCase();
  return ["tr","us","auto"].includes(scope)?scope:"auto";
}
async function onePortfolio(env, userId, portfolioId) {
  await ensurePortfolioMarketSchema(env);
  return env.DB.prepare(
    "SELECT p.id,p.user_id,p.name,p.broker,p.base_currency,COALESCE(s.market_scope,'auto') AS market_scope,COALESCE(s.cash_balance,0) AS cash_balance,p.sort_order,p.created_at,p.updated_at "+
    "FROM portfolios p LEFT JOIN portfolio_market_settings s ON s.portfolio_id=p.id AND s.user_id=p.user_id "+
    "WHERE p.id=? AND p.user_id=?"
  ).bind(portfolioId, userId).first();
}

let userBrokerSchemaReady=false;
async function ensureUserBrokerSchema(env){
  if(userBrokerSchemaReady)return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS user_brokers ("+
    "id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,code TEXT NOT NULL DEFAULT '',fee_mode TEXT NOT NULL DEFAULT 'manual',fee_value REAL NOT NULL DEFAULT 0,fee_min REAL NOT NULL DEFAULT 0,fee_max_pct REAL,fee_currency TEXT NOT NULL DEFAULT 'EUR',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,"+
    "canonical_name TEXT NOT NULL DEFAULT '',official_domain TEXT NOT NULL DEFAULT '',pricing_url TEXT NOT NULL DEFAULT '',plan TEXT NOT NULL DEFAULT '',fee_rules_json TEXT NOT NULL DEFAULT '{}',verification_status TEXT NOT NULL DEFAULT 'pending',last_verified_at TEXT,source_excerpt TEXT NOT NULL DEFAULT '',"+
    "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  const cols=await env.DB.prepare("PRAGMA table_info(user_brokers)").all();
  const names=new Set((cols.results||[]).map(row=>String(row.name||"")));
  const additions=[
    ["canonical_name","TEXT NOT NULL DEFAULT ''"],["official_domain","TEXT NOT NULL DEFAULT ''"],["pricing_url","TEXT NOT NULL DEFAULT ''"],
    ["plan","TEXT NOT NULL DEFAULT ''"],["fee_rules_json","TEXT NOT NULL DEFAULT '{}'"],["verification_status","TEXT NOT NULL DEFAULT 'pending'"],
    ["last_verified_at","TEXT"],["source_excerpt","TEXT NOT NULL DEFAULT ''"]
  ];
  for(const item of additions){if(!names.has(item[0]))await env.DB.prepare("ALTER TABLE user_brokers ADD COLUMN "+item[0]+" "+item[1]).run()}
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_brokers_user_name ON user_brokers(user_id,name)").run();
  userBrokerSchemaReady=true;
}
function builtinBrokerProfile(name){
  const key=String(name||"").trim().toLowerCase();
  if(/trade\s*republic|^tr$/.test(key))return{
    canonicalName:"Trade Republic",code:"TR",officialDomain:"traderepublic.com",pricingUrl:"https://traderepublic.com/en-es?openModal=pricing-scheme",
    plan:"Standard",status:"verified",rules:{type:"flat",buy:1,sell:1,currency:"EUR",market:"TR",note:"1 EUR external settlement cost per trade"}
  };
  if(/interactive\s*brokers|\bibkr\b/.test(key))return{
    canonicalName:"Interactive Brokers",code:"IBKR",officialDomain:"interactivebrokers.com",pricingUrl:"https://www.interactivebrokers.com/en/pricing/commissions-stocks.php",
    plan:"Pro Fixed",status:"verified",rules:{type:"per_share",perShare:0.005,min:1,maxPct:1,sellValueRate:0.0000206,sellPerShareExtra:0.000198,currency:"USD",market:"US",note:"IBKR Pro Fixed US stocks; sale regulatory fees included from official schedule"}
  };
  return null;
}
async function resolveBrokerProfile(env,name){
  const builtin=builtinBrokerProfile(name);if(builtin)return builtin;
  if(!env.AI||typeof env.AI.run!=="function")return{canonicalName:trimText(name,80),code:"",officialDomain:"",pricingUrl:"",plan:"",status:"pending",rules:{}};
  const model=configuredAiModel(env);
  try{
    const identifyPrompt=[
      "Identify the brokerage firm from the supplied name. Return JSON only.",
      "Keys: canonicalName, officialDomain, pricingUrl, plan.",
      "pricingUrl must be an official stock commission page only if confidently known. Otherwise leave it empty. Never invent a domain.",
      JSON.stringify({name:trimText(name,80)})
    ].join("\n");
    const identified=extractAiJson((await runWorkersAi(env,{prompt:identifyPrompt,max_tokens:220,temperature:0},model)).result)||{};
    const canonicalName=trimText(identified.canonicalName||name,80),officialDomain=trimText(identified.officialDomain,120).toLowerCase(),pricingUrl=trimText(identified.pricingUrl,500),plan=trimText(identified.plan,80);
    if(!officialDomain||!pricingUrl)return{canonicalName,code:"",officialDomain:"",pricingUrl:"",plan,status:"pending",rules:{}};
    const url=new URL(pricingUrl);
    if(!url.hostname.toLowerCase().endsWith(officialDomain))return{canonicalName,code:"",officialDomain:"",pricingUrl:"",plan,status:"pending",rules:{}};
    const response=await fetch(pricingUrl,{headers:{"User-Agent":"ViewInvAI/1.0 broker-fee-verifier"}});
    if(!response.ok)return{canonicalName,code:"",officialDomain,pricingUrl,plan,status:"pending",rules:{}};
    const html=await response.text(),plain=html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,18000);
    const feePrompt=[
      "Extract current STOCK trading commissions from this broker official pricing page. Return JSON only.",
      "Keys: type (flat|per_share|tiered|unknown), currency, buy, sell, perShare, min, maxPct, market, note.",
      "Use null when not explicit. Do not infer or invent missing values.",
      JSON.stringify({broker:canonicalName,plan,text:plain})
    ].join("\n");
    const fees=extractAiJson((await runWorkersAi(env,{prompt:feePrompt,max_tokens:320,temperature:0},model)).result)||{};
    const hasRule=["buy","sell","perShare","min","maxPct"].some(k=>finiteNumber(fees[k])!==null);
    return{canonicalName,code:"",officialDomain,pricingUrl,plan,status:hasRule?"verified":"pending",rules:fees,sourceExcerpt:plain.slice(0,700)};
  }catch(error){
    console.warn("Broker verification failed",String(error&&error.message||error));
    return{canonicalName:trimText(name,80),code:"",officialDomain:"",pricingUrl:"",plan:"",status:"pending",rules:{}};
  }
}
async function brokerFeeForTrade(env,userId,brokerName,quantity,price,currency,side="BUY",exchange=""){
  const name=trimText(brokerName,80),builtin=builtinBrokerProfile(name);
  let rules=builtin&&builtin.rules||null,status=builtin?"verified":"pending",label=builtin&&builtin.plan||"";
  if(!rules){
    await ensureUserBrokerSchema(env);
    const row=await env.DB.prepare(
      "SELECT * FROM user_brokers WHERE user_id=? AND (LOWER(name)=LOWER(?) OR LOWER(canonical_name)=LOWER(?) OR LOWER(code)=LOWER(?)) LIMIT 1"
    ).bind(userId,name,name,name).first();
    if(row){
      status=String(row.verification_status||"pending");label=row.plan||row.canonical_name||row.name||"";
      try{rules=JSON.parse(row.fee_rules_json||"{}")||{}}catch(_){rules={}}
    }
  }
  if(status!=="verified"||!rules)return{fee:null,currency:String(currency||"EUR").toUpperCase(),verified:false,label};
  const venue=String(exchange||"").trim().toUpperCase(),ruleMarket=String(rules.market||"").trim().toUpperCase();
  const usVenue=["NASDAQ","NYSE","AMEX","NYSE ARCA","NYSEARCA"].includes(venue);
  if(ruleMarket==="TR"&&venue&&venue!=="LSX")return{fee:null,currency:String(rules.currency||currency||"EUR").toUpperCase(),verified:false,label,reason:"market-mismatch"};
  if(ruleMarket==="US"&&venue&&!usVenue)return{fee:null,currency:String(rules.currency||currency||"USD").toUpperCase(),verified:false,label,reason:"market-mismatch"};
  const qty=Math.max(0,finiteNumber(quantity)||0),px=Math.max(0,finiteNumber(price)||0),tradeValue=qty*px,type=String(rules.type||"").toLowerCase();
  let fee=null;
  if(type==="flat"){
    const raw=finiteNumber(String(side).toUpperCase()==="SELL"?rules.sell:rules.buy);
    if(raw!==null)fee=raw;
  }else if(type==="per_share"){
    const per=finiteNumber(rules.perShare),minimum=Math.max(0,finiteNumber(rules.min)||0),maxPct=finiteNumber(rules.maxPct);
    if(per!==null){
      fee=Math.max(minimum,qty*per);
      if(maxPct!==null&&tradeValue>0)fee=Math.min(fee,tradeValue*maxPct/100);
      if(String(side).toUpperCase()==="SELL"){
        const valueRate=Math.max(0,finiteNumber(rules.sellValueRate)||0),shareExtra=Math.max(0,finiteNumber(rules.sellPerShareExtra)||0);
        fee+=tradeValue*valueRate+qty*shareExtra;
      }
    }
  }
  const feeCurrency=String(rules.currency||currency||"EUR").toUpperCase(),tradeCurrency=String(currency||feeCurrency).toUpperCase();
  // The fee is stored in the trade's currency column; never record e.g. 1 USD as 1 EUR.
  if(fee!==null&&feeCurrency!==tradeCurrency)return{fee:null,currency:tradeCurrency,verified:false,label,reason:"currency-mismatch"};
  return{fee,currency:feeCurrency,verified:fee!==null,label};
}

export async function runScheduledBrokerVerification(env,{limit=2}={}){
  await ensureUserBrokerSchema(env);
  const staleCutoff=new Date(Date.now()-14*86400000).toISOString();
  const pendingCutoff=new Date(Date.now()-10*60000).toISOString();
  const rows=await env.DB.prepare(
    "SELECT * FROM user_brokers WHERE verification_status='pending' OR last_verified_at IS NULL OR last_verified_at<? OR (verification_status<>'verified' AND updated_at<?) ORDER BY CASE WHEN verification_status='pending' THEN 0 ELSE 1 END,last_verified_at ASC,updated_at ASC LIMIT ?"
  ).bind(staleCutoff,pendingCutoff,Math.max(1,Math.min(5,Math.round(Number(limit)||2)))).all();
  const results=[];
  for(const row of (rows.results||[])){
    try{
      const resolved=await resolveBrokerProfile(env,row.name),now=nowIso(),rules=JSON.stringify(resolved.rules||{});
      await env.DB.prepare(
        "UPDATE user_brokers SET code=?,fee_mode='auto',fee_currency=?,canonical_name=?,official_domain=?,pricing_url=?,plan=?,fee_rules_json=?,verification_status=?,last_verified_at=?,source_excerpt=?,updated_at=? WHERE id=? AND user_id=?"
      ).bind(
        resolved.code||row.code||"",(resolved.rules&&resolved.rules.currency)||row.fee_currency||"EUR",
        resolved.canonicalName||row.canonical_name||row.name,resolved.officialDomain||row.official_domain||"",
        resolved.pricingUrl||row.pricing_url||"",resolved.plan||row.plan||"",rules,resolved.status||"pending",
        resolved.status==="verified"?now:row.last_verified_at||null,resolved.sourceExcerpt||row.source_excerpt||"",now,row.id,row.user_id
      ).run();
      results.push({id:row.id,status:resolved.status||"pending"});
    }catch(error){
      console.warn("Scheduled broker verification failed",row&&row.id,String(error&&error.message||error));
    }
  }
  return{processed:results.length,results};
}

async function handleBrokers(request,env,user,json,parts){
  await ensureUserBrokerSchema(env);
  const id=parts[1]||"",action=parts[2]||"";
  if(request.method==="GET"&&!id){
    const rows=await env.DB.prepare("SELECT * FROM user_brokers WHERE user_id=? ORDER BY canonical_name,name").bind(user.id).all();
    return json({brokers:rows.results||[]});
  }
  if(request.method==="POST"&&!id){
    const body=await readJson(request),name=trimText(body.name,80);
    if(!name)return json({error:"Broker name required"},400);
    const now=nowIso(),idNew=uid("br_");
    await env.DB.prepare(
      "INSERT INTO user_brokers (id,user_id,name,code,fee_mode,fee_value,fee_min,fee_max_pct,fee_currency,canonical_name,official_domain,pricing_url,plan,fee_rules_json,verification_status,last_verified_at,source_excerpt,created_at,updated_at) "+
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET verification_status='pending',updated_at=excluded.updated_at"
    ).bind(idNew,user.id,name,"","auto",0,0,null,"EUR",name,"","","","{}","pending",null,"",now,now).run();
    const row=await env.DB.prepare("SELECT * FROM user_brokers WHERE user_id=? AND name=?").bind(user.id,name).first();
    return json({broker:row},201);
  }
  if(request.method==="POST"&&id&&action==="verify"){
    const row=await env.DB.prepare("SELECT * FROM user_brokers WHERE id=? AND user_id=?").bind(id,user.id).first();
    if(!row)return json({error:"Broker not found"},404);
    const resolved=await resolveBrokerProfile(env,row.name),now=nowIso(),rules=JSON.stringify(resolved.rules||{});
    await env.DB.prepare(
      "UPDATE user_brokers SET code=?,fee_mode='auto',fee_currency=?,canonical_name=?,official_domain=?,pricing_url=?,plan=?,fee_rules_json=?,verification_status=?,last_verified_at=?,source_excerpt=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(resolved.code||"",(resolved.rules&&resolved.rules.currency)||row.fee_currency||"EUR",resolved.canonicalName||row.name,resolved.officialDomain||"",resolved.pricingUrl||"",resolved.plan||"",rules,resolved.status||"pending",resolved.status==="verified"?now:null,resolved.sourceExcerpt||"",now,id,user.id).run();
    return json({broker:await env.DB.prepare("SELECT * FROM user_brokers WHERE id=? AND user_id=?").bind(id,user.id).first()});
  }
  return json({error:"Method not allowed"},405);
}

function portfolioPayload(body) {
  return {
    name: trimText(body.name, 80),
    broker: trimText(body.broker, 80),
    baseCurrency: /^[A-Z]{3}$/.test(String(body.baseCurrency || "EUR").toUpperCase())
      ? String(body.baseCurrency || "EUR").toUpperCase()
      : "EUR",
    marketScope: normalizedMarketScope(body.marketScope),
    cashBalance: Math.max(0, Math.min(100000000, finiteNumber(body.cashBalance) || 0)),
    sortOrder: Math.max(-1000, Math.min(1000, Math.round(finiteNumber(body.sortOrder) || 0)))
  };
}

function positionPayload(body) {
  const stockKey = trimText(body.stockKey, 80).toUpperCase();
  const ticker = trimText(body.ticker, 20).toUpperCase();
  return {
    portfolioId: trimText(body.portfolioId, 80),
    stockKey,
    ticker,
    name: trimText(body.name, 160),
    exchange: trimText(body.exchange, 40).toUpperCase(),
    isin: trimText(body.isin, 24).toUpperCase(),
    preferTr: booleanInt(body.preferTr),
    quantity: finiteNumber(body.quantity),
    avgPrice: finiteNumber(body.avgPrice),
    currency: /^[A-Z]{3}$/.test(String(body.currency || "EUR").toUpperCase())
      ? String(body.currency || "EUR").toUpperCase()
      : "EUR",
    openedAt: trimText(body.openedAt, 40) || null,
    notes: trimText(body.notes, 1000),
    broker: trimText(body.broker, 80),
    fees: finiteNumber(body.fees),
    cashFxRate: finiteNumber(body.cashFxRate)
  };
}

function transactionPayload(body) {
  const side = String(body.side || "").trim().toUpperCase();
  const currency = String(body.currency || "EUR").trim().toUpperCase();
  const quantity = finiteNumber(body.quantity);
  const price = finiteNumber(body.price);
  const preferTr = booleanInt(body.preferTr);
  const rawFees = finiteNumber(body.fees);
  const executedRaw = trimText(body.executedAt, 40);
  const executedDate = executedRaw ? new Date(executedRaw) : new Date();
  return {
    portfolioId: trimText(body.portfolioId, 80),
    stockKey: trimText(body.stockKey, 80).toUpperCase(),
    ticker: trimText(body.ticker, 20).toUpperCase(),
    name: trimText(body.name, 160),
    exchange: trimText(body.exchange, 40).toUpperCase(),
    isin: trimText(body.isin, 24).toUpperCase(),
    preferTr,
    side,
    quantity,
    price,
    fees: rawFees,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
    cashFxRate: finiteNumber(body.cashFxRate),
    executedAt: Number.isFinite(executedDate.getTime()) ? executedDate.toISOString() : "",
    notes: trimText(body.notes, 1000),
    positionId: trimText(body.positionId, 80),
    broker: trimText(body.broker, 80)
  };
}

function transactionCashDelta(side,quantity,price,fees){
  const qty=finiteNumber(quantity),px=finiteNumber(price),commission=Math.max(0,finiteNumber(fees)||0);
  if(qty===null||qty<=0||px===null||px<0)return 0;
  const gross=qty*px;
  return String(side||"").toUpperCase()==="SELL" ? gross-commission : -(gross+commission);
}

async function adjustPortfolioCashForTransaction(env,userId,portfolioId,currency,side,quantity,price,fees,multiplier=1,recordedDelta=null,cashFxRate=null){
  const portfolio=await onePortfolio(env,userId,portfolioId);
  if(!portfolio)return{adjusted:false,reason:"portfolio-not-found"};
  const base=String(portfolio.base_currency||"EUR").toUpperCase();
  const txCurrency=String(currency||base).toUpperCase();
  const before=Math.max(0,finiteNumber(portfolio.cash_balance)||0);
  let baseDelta=recordedDelta===null?transactionCashDelta(side,quantity,price,fees):(finiteNumber(recordedDelta)||0);
  if(recordedDelta===null&&base!==txCurrency){
    const rate=finiteNumber(cashFxRate);
    if(rate===null||rate<=0){
      return{adjusted:false,reason:"currency-mismatch",baseCurrency:base,transactionCurrency:txCurrency,cashBalance:before};
    }
    baseDelta*=rate;
  }
  const rawDelta=baseDelta*(multiplier<0?-1:1);
  const unclamped=before+rawDelta,next=Math.max(0,Math.round((unclamped+Number.EPSILON)*1000000)/1000000);
  const shortfall=Math.max(0,-unclamped);
  const updatedAt=nowIso();
  await env.DB.prepare(
    "INSERT INTO portfolio_market_settings (portfolio_id,user_id,market_scope,cash_balance,updated_at) VALUES (?,?,?,?,?) "+
    "ON CONFLICT(portfolio_id) DO UPDATE SET cash_balance=excluded.cash_balance,updated_at=excluded.updated_at"
  ).bind(portfolioId,userId,normalizedMarketScope(portfolio.market_scope),next,updatedAt).run();
  return{adjusted:true,before,cashBalance:next,delta:next-before,requestedDelta:rawDelta,shortfall,baseCurrency:base};
}


function fundPortfolioPayload(body) {
  return {
    name: trimText(body.name, 80),
    platform: trimText(body.platform, 60),
    baseCurrency: /^[A-Z]{3}$/.test(String(body.baseCurrency || "EUR").toUpperCase())
      ? String(body.baseCurrency || "EUR").toUpperCase()
      : "EUR",
    sortOrder: Math.max(-1000, Math.min(1000, Math.round(finiteNumber(body.sortOrder) || 0)))
  };
}

function fundPositionPayload(body) {
  const isin = trimText(body.isin, 24).toUpperCase();
  const rawProductType = String(body.productType || "fund").toLowerCase();
  const productType = ["fund","etf","etp"].includes(rawProductType) ? rawProductType : "fund";
  const units = finiteNumber(body.units);
  const avgPrice = finiteNumber(body.avgPrice);
  return {
    fundPortfolioId: trimText(body.fundPortfolioId, 80),
    isin,
    name: trimText(body.name, 180),
    productType,
    provider: trimText(body.provider, 120),
    indexName: trimText(body.indexName, 160),
    platform: trimText(body.platform, 60),
    units,
    avgPrice,
    currency: /^[A-Z]{3}$/.test(String(body.currency || "EUR").toUpperCase())
      ? String(body.currency || "EUR").toUpperCase()
      : "EUR",
    openedAt: trimText(body.openedAt, 40) || null,
    notes: trimText(body.notes, 1000)
  };
}

let fundSchemaReady = false;
async function ensureFundSchema(env) {
  if (fundSchemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS fund_portfolios (" +
      "id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,platform TEXT NOT NULL DEFAULT '',base_currency TEXT NOT NULL DEFAULT 'EUR',sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fund_portfolios_user ON fund_portfolios(user_id,sort_order,created_at)"),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS fund_positions (" +
      "id TEXT PRIMARY KEY,fund_portfolio_id TEXT NOT NULL,user_id TEXT NOT NULL,isin TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',product_type TEXT NOT NULL DEFAULT 'fund' CHECK(product_type IN ('fund','etf','etp')),provider TEXT NOT NULL DEFAULT '',index_name TEXT NOT NULL DEFAULT '',platform TEXT NOT NULL DEFAULT '',units REAL NOT NULL DEFAULT 0 CHECK(units>=0),avg_price REAL,currency TEXT NOT NULL DEFAULT 'EUR',opened_at TEXT,notes TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_positions_portfolio_isin ON fund_positions(fund_portfolio_id,isin)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fund_positions_user_active ON fund_positions(user_id,active)"),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS fund_transactions (" +
      "id TEXT PRIMARY KEY,fund_portfolio_id TEXT NOT NULL,fund_position_id TEXT NOT NULL,user_id TEXT NOT NULL,isin TEXT NOT NULL,side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),units REAL NOT NULL CHECK(units>0),price REAL NOT NULL CHECK(price>=0),fees REAL NOT NULL DEFAULT 0 CHECK(fees>=0),currency TEXT NOT NULL DEFAULT 'EUR',executed_at TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,FOREIGN KEY(fund_position_id) REFERENCES fund_positions(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fund_transactions_user_date ON fund_transactions(user_id,executed_at DESC,created_at DESC)"),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS fund_contribution_plans (" +
      "id TEXT PRIMARY KEY,fund_portfolio_id TEXT NOT NULL,fund_position_id TEXT,user_id TEXT NOT NULL,isin TEXT NOT NULL DEFAULT '',label TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'monthly',amount REAL,currency TEXT NOT NULL DEFAULT 'EUR',day_of_month INTEGER,frequency TEXT NOT NULL DEFAULT 'monthly',start_date TEXT,status TEXT NOT NULL DEFAULT 'active',next_contribution_at TEXT,enabled INTEGER NOT NULL DEFAULT 1,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,FOREIGN KEY(fund_position_id) REFERENCES fund_positions(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fund_plans_user ON fund_contribution_plans(user_id,fund_portfolio_id,enabled)")
  ]);
  const planColumns=await env.DB.prepare("PRAGMA table_info(fund_contribution_plans)").all();
  const planColumnNames=new Set((planColumns.results||[]).map(row=>String(row.name||"")));
  for(const [name,sql] of [
    ["start_date","ALTER TABLE fund_contribution_plans ADD COLUMN start_date TEXT"],
    ["status","ALTER TABLE fund_contribution_plans ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
    ["next_contribution_at","ALTER TABLE fund_contribution_plans ADD COLUMN next_contribution_at TEXT"]
  ]){
    if(!planColumnNames.has(name))await env.DB.prepare(sql).run();
  }
  // Broker id of each imported fund operation: re-importing never duplicates.
  const fundTxColumns=await env.DB.prepare("PRAGMA table_info(fund_transactions)").all();
  if(!(fundTxColumns.results||[]).some(row=>String(row.name||"")==="external_id")){
    await env.DB.prepare("ALTER TABLE fund_transactions ADD COLUMN external_id TEXT NOT NULL DEFAULT ''").run();
  }
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_transactions_external ON fund_transactions(user_id,external_id) WHERE external_id<>''").run();
  fundSchemaReady = true;
}

async function oneFundPortfolio(env, userId, id) {
  await ensureFundSchema(env);
  return env.DB.prepare(
    "SELECT id,user_id,name,platform,base_currency,sort_order,created_at,updated_at FROM fund_portfolios WHERE id=? AND user_id=?"
  ).bind(id, userId).first();
}

let transactionsSchemaReady = false;
async function ensureTransactionsSchema(env) {
  if (transactionsSchemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS transactions (" +
      "id TEXT PRIMARY KEY,portfolio_id TEXT NOT NULL,user_id TEXT NOT NULL,stock_key TEXT NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',exchange TEXT NOT NULL DEFAULT '',isin TEXT NOT NULL DEFAULT '',prefer_tr INTEGER NOT NULL DEFAULT 0," +
      "side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),quantity REAL NOT NULL CHECK(quantity>0),price REAL NOT NULL CHECK(price>=0),fees REAL NOT NULL DEFAULT 0 CHECK(fees>=0),currency TEXT NOT NULL DEFAULT 'EUR',executed_at TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',origin TEXT NOT NULL DEFAULT 'manual',cash_delta REAL NOT NULL DEFAULT 0,cash_currency TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id,executed_at DESC,created_at DESC)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_date ON transactions(portfolio_id,executed_at DESC,created_at DESC)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_transactions_stock ON transactions(user_id,portfolio_id,stock_key,executed_at,created_at)")
  ]);
  const txColumns=await env.DB.prepare("PRAGMA table_info(transactions)").all();
  const txNames=new Set((txColumns.results||[]).map(row=>String(row.name||"")));
  if(!txNames.has("cash_delta"))await env.DB.prepare("ALTER TABLE transactions ADD COLUMN cash_delta REAL NOT NULL DEFAULT 0").run();
  if(!txNames.has("cash_currency"))await env.DB.prepare("ALTER TABLE transactions ADD COLUMN cash_currency TEXT NOT NULL DEFAULT ''").run();
  if(!txNames.has("broker"))await env.DB.prepare("ALTER TABLE transactions ADD COLUMN broker TEXT NOT NULL DEFAULT ''").run();
  if(!txNames.has("position_id"))await env.DB.prepare("ALTER TABLE transactions ADD COLUMN position_id TEXT NOT NULL DEFAULT ''").run();
  if(!txNames.has("external_id"))await env.DB.prepare("ALTER TABLE transactions ADD COLUMN external_id TEXT NOT NULL DEFAULT ''").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external ON transactions(user_id,external_id) WHERE external_id<>''").run();
  await env.DB.prepare(
    "UPDATE transactions SET position_id=COALESCE((SELECT p.id FROM positions p WHERE p.user_id=transactions.user_id AND p.portfolio_id=transactions.portfolio_id AND p.stock_key=transactions.stock_key ORDER BY p.updated_at DESC LIMIT 1),'') WHERE position_id=''"
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_transactions_position ON transactions(user_id,position_id,executed_at,created_at)").run();
  transactionsSchemaReady = true;
}

async function normalizeLegacyTrSeedFees(env,userId,portfolioId,stockKey){
  try{
    await env.DB.prepare(
      "UPDATE transactions SET fees=1,updated_at=? WHERE user_id=? AND portfolio_id=? AND stock_key=? AND origin='position-seed' AND prefer_tr=1 AND fees=0"
    ).bind(nowIso(),userId,portfolioId,stockKey).run();
  }catch(error){
    console.warn("Legacy TR seed fee normalization failed",String(error&&error.message||error));
  }
}

async function transactionRows(env, userId, portfolioId, stockKey, positionId="") {
  await ensureTransactionsSchema(env);
  await normalizeLegacyTrSeedFees(env,userId,portfolioId,stockKey);
  const pid=trimText(positionId,80);
  const rows = pid
    ? await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND position_id=? ORDER BY executed_at ASC,created_at ASC,id ASC"
      ).bind(userId,pid).all()
    : await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND portfolio_id=? AND stock_key=? ORDER BY executed_at ASC,created_at ASC,id ASC"
      ).bind(userId,portfolioId,stockKey).all();
  return rows.results || [];
}

export function calculateTransactionLedger(rows) {
  let quantity = 0;
  let grossCostBasis = 0;
  let netCostBasis = 0;
  let firstBuyAt = null;
  let currency = null;
  const realizedByCurrency = {};
  const feesByCurrency = {};

  const addAmount = (bucket, key, value) => {
    key = String(key || "EUR").toUpperCase();
    bucket[key] = (bucket[key] || 0) + value;
  };

  for (const row of rows || []) {
    const side = String(row.side || "").toUpperCase();
    const origin = String(row.origin || "");
    const qty = finiteNumber(row.quantity);
    const price = finiteNumber(row.price);
    const fees = Math.max(0, finiteNumber(row.fees) || 0);
    const rowCurrency = String(row.currency || currency || "EUR").toUpperCase();
    if (!qty || qty <= 0 || price === null || price < 0) continue;
    if (!currency) currency = rowCurrency;

    if (origin === "position-adjustment") {
      if (!firstBuyAt) firstBuyAt = row.executed_at || row.created_at || null;
      quantity = qty;
      grossCostBasis = qty * price;
      netCostBasis = qty * price;
      currency = rowCurrency;
      addAmount(feesByCurrency, rowCurrency, fees);
      continue;
    }

    if (side === "BUY") {
      if (quantity > 1e-8 && currency !== rowCurrency) throw new Error("Transaction currency differs from current position");
      if (quantity <= 1e-8) currency = rowCurrency;
      if (!firstBuyAt) firstBuyAt = row.executed_at || row.created_at || null;
      quantity += qty;
      grossCostBasis += qty * price;
      netCostBasis += qty * price + fees;
      addAmount(feesByCurrency, rowCurrency, fees);
      continue;
    }

    if (side === "SELL") {
      if (qty > quantity + 1e-8) throw new Error("Sell quantity exceeds current position");
      if (currency !== rowCurrency) throw new Error("Transaction currency differs from current position");
      const avgGross = quantity > 1e-8 ? grossCostBasis / quantity : 0;
      const avgNet = quantity > 1e-8 ? netCostBasis / quantity : 0;
      const realized = qty * price - fees - qty * avgNet;
      addAmount(realizedByCurrency, rowCurrency, realized);
      addAmount(feesByCurrency, rowCurrency, fees);
      quantity -= qty;
      grossCostBasis -= qty * avgGross;
      netCostBasis -= qty * avgNet;
      if (quantity <= 1e-8) {
        quantity = 0;
        grossCostBasis = 0;
        netCostBasis = 0;
      }
    }
  }

  const realizedCurrencies = Object.keys(realizedByCurrency);
  const feeCurrencies = Object.keys(feesByCurrency);
  const realizedPnl = realizedCurrencies.length <= 1
    ? realizedCurrencies.reduce((sum, key) => sum + realizedByCurrency[key], 0)
    : null;
  const totalFees = feeCurrencies.length <= 1
    ? feeCurrencies.reduce((sum, key) => sum + feesByCurrency[key], 0)
    : null;

  return {
    quantity,
    avgPrice: quantity > 1e-8 ? grossCostBasis / quantity : null,
    avgCost: quantity > 1e-8 ? netCostBasis / quantity : null,
    grossInvested: grossCostBasis,
    invested: netCostBasis,
    realizedPnl,
    realizedByCurrency,
    totalFees,
    feesByCurrency,
    currency: currency || "EUR",
    firstBuyAt
  };
}

export function calculatePortfolioTransactionSummary(rows) {
  const sorted = [...(rows || [])].sort((a,b) =>
    String(a.executed_at || "").localeCompare(String(b.executed_at || "")) ||
    String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
    String(a.id || "").localeCompare(String(b.id || ""))
  );
  const groups = new Map();
  const currencies = {};
  let buys = 0, sells = 0, adjustments = 0;

  for (const row of sorted) {
    const side = String(row.side || "").toUpperCase();
    const origin = String(row.origin || "");
    const currency = String(row.currency || "EUR").toUpperCase();
    const qty = finiteNumber(row.quantity);
    const price = finiteNumber(row.price);
    const fees = Math.max(0, finiteNumber(row.fees) || 0);
    if (!currencies[currency]) currencies[currency] = { buyGross: 0, sellGross: 0, fees: 0, realizedPnl: 0 };
    if (qty !== null && qty > 0 && price !== null && price >= 0) {
      if (origin === "position-adjustment") adjustments++;
      else if (side === "BUY") { currencies[currency].buyGross += qty * price; buys++; }
      else if (side === "SELL") { currencies[currency].sellGross += qty * price; sells++; }
      currencies[currency].fees += fees;
    }
    const key = String(row.stock_key || row.ticker || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const groupRows of groups.values()) {
    const ledger = calculateTransactionLedger(groupRows);
    const realized = ledger.realizedByCurrency && typeof ledger.realizedByCurrency === "object"
      ? ledger.realizedByCurrency
      : (ledger.realizedPnl === null || ledger.realizedPnl === undefined ? {} : { [String(ledger.currency || "EUR").toUpperCase()]: ledger.realizedPnl });
    for (const [currency, amount] of Object.entries(realized)) {
      const key = String(currency || "EUR").toUpperCase();
      if (!currencies[key]) currencies[key] = { buyGross: 0, sellGross: 0, fees: 0, realizedPnl: 0 };
      currencies[key].realizedPnl += finiteNumber(amount) || 0;
    }
  }

  for (const value of Object.values(currencies)) {
    for (const key of ["buyGross","sellGross","fees","realizedPnl"]) {
      value[key] = Math.round((value[key] + Number.EPSILON) * 1000000) / 1000000;
    }
  }
  return { total: sorted.length, buys, sells, adjustments, stocks: groups.size, currencies };
}

async function ensureOpeningTransaction(env, userId, position) {
  if (!position || finiteNumber(position.quantity) === null || finiteNumber(position.quantity) <= 0 || finiteNumber(position.avg_price) === null) return null;
  await ensureTransactionsSchema(env);
  const existing = await env.DB.prepare(
    "SELECT id,fees FROM transactions WHERE user_id=? AND position_id=? LIMIT 1"
  ).bind(userId, position.id).first();
  if (existing) return {id:existing.id,created:false,fee:finiteNumber(existing.fees)||0};

  const now = nowIso();
  const executed = trimText(position.opened_at, 40);
  const d = executed ? new Date(executed) : new Date(now);
  const executedAt = Number.isFinite(d.getTime()) ? d.toISOString() : now;
  const broker=trimText(position.broker,80);
  const explicitFee=finiteNumber(position.opening_fee);
  const feeInfo=explicitFee===null?await brokerFeeForTrade(env,userId,broker,position.quantity,position.avg_price,position.currency,"BUY",position.exchange):null;
  const fee=explicitFee!==null?Math.max(0,explicitFee):(feeInfo&&feeInfo.fee!==null?feeInfo.fee:0);
  const txId=uid("tx_");
  await env.DB.prepare(
    "INSERT INTO transactions (id,portfolio_id,user_id,position_id,broker,stock_key,ticker,name,exchange,isin,prefer_tr,side,quantity,price,fees,currency,executed_at,notes,origin,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,'BUY',?,?,?,?,?,?,'position-seed',?,?)"
  ).bind(
    txId, position.portfolio_id, userId, position.id, broker, position.stock_key, position.ticker, position.name || "",
    position.exchange || "", position.isin || "", booleanInt(position.prefer_tr),
    finiteNumber(position.quantity), finiteNumber(position.avg_price), fee, String(position.currency || "EUR").toUpperCase(),
    executedAt, "Posición inicial importada", now, now
  ).run();
  return {id:txId,created:true,fee};
}

async function appendPositionAdjustment(env, userId, position, data) {
  if (!position || data.quantity === null || data.quantity <= 0 || data.avgPrice === null || data.avgPrice < 0) return false;
  await ensureTransactionsSchema(env);
  await ensureOpeningTransaction(env, userId, position);
  const rows = await transactionRows(env, userId, position.portfolio_id, position.stock_key, position.id);
  const ledger = calculateTransactionLedger(rows);
  const targetCurrency = String(data.currency || position.currency || ledger.currency || "EUR").toUpperCase();
  const changed =
    Math.abs((ledger.quantity || 0) - data.quantity) > 1e-8 ||
    ledger.avgPrice === null ||
    Math.abs((ledger.avgPrice || 0) - data.avgPrice) > 1e-8 ||
    String(ledger.currency || targetCurrency).toUpperCase() !== targetCurrency;
  if (!changed) return false;

  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO transactions (id,portfolio_id,user_id,position_id,broker,stock_key,ticker,name,exchange,isin,prefer_tr,side,quantity,price,fees,currency,executed_at,notes,origin,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,'BUY',?,?,0,?,?,?,'position-adjustment',?,?)"
  ).bind(
    uid("tx_"), position.portfolio_id, userId, position.id, trimText(position.broker||data.broker,80), position.stock_key,
    data.ticker || position.ticker || "", data.name || position.name || "",
    data.exchange || position.exchange || "", data.isin || position.isin || "",
    data.preferTr, data.quantity, data.avgPrice, targetCurrency, now,
    "Ajuste manual desde Gestionar cartera", now, now
  ).run();
  return true;
}

async function recalculatePositionFromTransactions(env, userId, portfolioId, stockKey, positionId="") {
  const pid=trimText(positionId,80);
  const rows = await transactionRows(env, userId, portfolioId, stockKey, pid);
  if (!rows.length) return null;
  const ledger = calculateTransactionLedger(rows);
  const first = rows[0];
  const now = nowIso();
  let existing=pid
    ? await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(pid,userId).first()
    : null;
  if(!existing){
    existing=await env.DB.prepare(
      "SELECT * FROM positions WHERE user_id=? AND portfolio_id=? AND stock_key=? AND broker=? AND currency=? AND prefer_tr=? AND exchange=?"
    ).bind(
      userId,portfolioId,stockKey,trimText(first.broker,80),String(first.currency||"EUR").toUpperCase(),
      booleanInt(first.prefer_tr),trimText(first.exchange,40).toUpperCase()
    ).first();
  }
  const resolvedId=existing&&existing.id?existing.id:(pid||uid("pos_"));
  const analysisChanged=!existing||
    Math.abs((finiteNumber(existing.quantity)||0)-(finiteNumber(ledger.quantity)||0))>1e-8||
    Math.abs((finiteNumber(existing.avg_price)||0)-(finiteNumber(ledger.avgPrice)||0))>1e-8||
    String(existing.currency||"").toUpperCase()!==String(ledger.currency||"").toUpperCase()||
    Number(existing.active)!==(ledger.quantity>1e-8?1:0);
  if(existing){
    await env.DB.prepare(
      "UPDATE positions SET ticker=?,name=?,exchange=?,isin=?,prefer_tr=?,quantity=?,avg_price=?,cost_basis=?,fees_total=?,currency=?,broker=?,opened_at=?,active=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(
      existing.ticker||first.ticker||"",existing.name||first.name||"",existing.exchange||first.exchange||"",
      existing.isin||first.isin||"",booleanInt(existing.prefer_tr),ledger.quantity,ledger.avgPrice,ledger.invested,ledger.totalFees||0,ledger.currency,
      existing.broker||first.broker||"",existing.opened_at||ledger.firstBuyAt,ledger.quantity>1e-8?1:0,now,resolvedId,userId
    ).run();
    // Si baja la cantidad, la congelación no puede pasar de lo que queda (y se borra al cerrar la posición):
    // así una recompra posterior no hereda una congelación antigua.
    if(!(ledger.quantity>1e-8)){
      try{await env.DB.prepare("DELETE FROM position_decisions WHERE user_id=? AND position_id=?").bind(userId,resolvedId).run()}catch(_){}
    }
    const frozenNow=finiteNumber(existing.frozen_qty)??0;
    if(frozenNow>0&&ledger.quantity<frozenNow-1e-9){
      const keep=ledger.quantity>1e-8?Math.round(ledger.quantity*1e8)/1e8:0;
      await env.DB.prepare("UPDATE positions SET frozen_qty=?,frozen_until=CASE WHEN ?>0 THEN frozen_until ELSE NULL END WHERE id=? AND user_id=?")
        .bind(keep,keep,resolvedId,userId).run();
    }
  }else{
    await env.DB.prepare(
      "INSERT INTO positions (id,portfolio_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,quantity,avg_price,cost_basis,fees_total,currency,broker,opened_at,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      resolvedId,portfolioId,userId,stockKey,first.ticker||"",first.name||"",first.exchange||"",first.isin||"",
      booleanInt(first.prefer_tr),ledger.quantity,ledger.avgPrice,ledger.invested,ledger.totalFees||0,ledger.currency,first.broker||"",ledger.firstBuyAt||now,"",
      ledger.quantity>1e-8?1:0,now,now
    ).run();
  }
  if(analysisChanged){
    await env.DB.prepare(
      "UPDATE positions SET last_analysis_at=NULL,last_signal=NULL,last_confidence=NULL,last_score=NULL,last_snapshot_id=NULL WHERE id=? AND user_id=?"
    ).bind(resolvedId,userId).run();
  }
  return {
    position: await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(resolvedId,userId).first(),
    ledger
  };
}

function watchPayload(body) {
  return {
    stockKey: trimText(body.stockKey, 80).toUpperCase(),
    ticker: trimText(body.ticker, 20).toUpperCase(),
    name: trimText(body.name, 160),
    exchange: trimText(body.exchange, 40).toUpperCase(),
    isin: trimText(body.isin, 24).toUpperCase(),
    preferTr: booleanInt(body.preferTr),
    notes: trimText(body.notes, 1000)
  };
}

async function handleMe(request, env, user, json) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const analysis = await env.DB.prepare(
    "SELECT analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change FROM user_settings WHERE user_id=?"
  ).bind(user.id).first();
  const notifications = await globalNotificationSettingsForUser(env, user.id);
  const settings = Object.assign({
    analysis_positions_minutes: 10,
    analysis_watchlist_minutes: 30,
    min_buy_confidence: 85,
    min_sell_confidence: 80,
    notify_score_change: 20
  }, analysis || {}, {
    notifications_enabled: notifications.enabled ? 1 : 0,
    notify_news_events: notifications.newsEvents ? 1 : 0,
    notify_catalyst_eve: notifications.catalystEve ? 1 : 0,
    notify_radar: notifications.radar ? 1 : 0,
    notify_radar_high: notifications.radarHigh ? 1 : 0,
    notify_radar_opportunity: notifications.radarOpportunity ? 1 : 0,
    notify_radar_watch: notifications.radarWatch ? 1 : 0,
    notify_price: notifications.price ? 1 : 0,
    notify_portfolio: notifications.portfolio ? 1 : 0,
    notify_portfolio_goal: notifications.portfolioGoal ? 1 : 0
  });
  return json({ user, settings }, 200, { "Cache-Control": "no-store" });
}

async function handlePortfolios(request, env, user, json, parts) {
  await ensurePortfolioMarketSchema(env);
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const rows = await env.DB.prepare(
      "SELECT p.*,COALESCE(s.market_scope,'auto') AS market_scope,COALESCE(s.cash_balance,0) AS cash_balance,(SELECT COUNT(*) FROM positions x WHERE x.portfolio_id=p.id AND x.active=1) AS position_count " +
      "FROM portfolios p LEFT JOIN portfolio_market_settings s ON s.portfolio_id=p.id AND s.user_id=p.user_id "+
      "WHERE p.user_id=? ORDER BY p.sort_order ASC,p.created_at ASC"
    ).bind(user.id).all();
    return json({ portfolios: rows.results || [] });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = portfolioPayload(body);
    if (!data.name) return json({ error: "Portfolio name is required" }, 400);
    const idNew = uid("pf_");
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO portfolios (id,user_id,name,broker,base_currency,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(idNew,user.id,data.name,data.broker,data.baseCurrency,data.sortOrder,now,now),
      env.DB.prepare(
        "INSERT INTO portfolio_market_settings (portfolio_id,user_id,market_scope,cash_balance,updated_at) VALUES (?,?,?,?,?) "+
        "ON CONFLICT(portfolio_id) DO UPDATE SET market_scope=excluded.market_scope,cash_balance=excluded.cash_balance,updated_at=excluded.updated_at"
      ).bind(idNew,user.id,data.marketScope,data.cashBalance,now)
    ]);
    return json({ portfolio: await onePortfolio(env, user.id, idNew) }, 201);
  }

  if (!id) return json({ error: "Portfolio id required" }, 400);
  const existing = await onePortfolio(env, user.id, id);
  if (!existing) return json({ error: "Portfolio not found" }, 404);
  if (request.method === "POST" && parts[2] === "dedupe") {
    await ensureTransactionsSchema(env);
    return json(await retireManualEntries(env, user.id, id));
  }

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const data = portfolioPayload({
      name: body.name !== undefined ? body.name : existing.name,
      broker: body.broker !== undefined ? body.broker : existing.broker,
      baseCurrency: body.baseCurrency !== undefined ? body.baseCurrency : existing.base_currency,
      marketScope: body.marketScope !== undefined ? body.marketScope : existing.market_scope,
      cashBalance: body.cashBalance !== undefined ? body.cashBalance : existing.cash_balance,
      sortOrder: body.sortOrder !== undefined ? body.sortOrder : existing.sort_order
    });
    if (!data.name) return json({ error: "Portfolio name is required" }, 400);
    if(data.marketScope!=="auto"){
      const conflicts=await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM positions WHERE user_id=? AND portfolio_id=? AND active=1 AND prefer_tr<>?"
      ).bind(user.id,id,data.marketScope==="tr"?1:0).first();
      if(Number(conflicts&&conflicts.n||0)>0){
        return json({error:"La cartera contiene posiciones de otro mercado. Mueve o elimina esas posiciones antes de cambiar el mercado."},409);
      }
    }
    const updatedAt=nowIso();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE portfolios SET name=?,broker=?,base_currency=?,sort_order=?,updated_at=? WHERE id=? AND user_id=?"
      ).bind(data.name,data.broker,data.baseCurrency,data.sortOrder,updatedAt,id,user.id),
      env.DB.prepare(
        "INSERT INTO portfolio_market_settings (portfolio_id,user_id,market_scope,cash_balance,updated_at) VALUES (?,?,?,?,?) "+
        "ON CONFLICT(portfolio_id) DO UPDATE SET market_scope=excluded.market_scope,cash_balance=excluded.cash_balance,updated_at=excluded.updated_at"
      ).bind(id,user.id,data.marketScope,data.cashBalance,updatedAt)
    ]);
    return json({ portfolio: await onePortfolio(env, user.id, id) });
  }

  if (request.method === "DELETE") {
    await ensureTransactionsSchema(env);
    await ensurePortfolioGoalSchema(env);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM portfolio_goals WHERE portfolio_id=? AND user_id=?").bind(id,user.id),
      env.DB.prepare("DELETE FROM portfolio_market_settings WHERE portfolio_id=? AND user_id=?").bind(id,user.id),
      env.DB.prepare("DELETE FROM transactions WHERE portfolio_id=? AND user_id=?").bind(id, user.id),
      env.DB.prepare("DELETE FROM positions WHERE portfolio_id=? AND user_id=?").bind(id, user.id),
      env.DB.prepare("DELETE FROM portfolios WHERE id=? AND user_id=?").bind(id, user.id)
    ]);
    return json({ deleted: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function notifyPortfolioMembershipChange(env,userId,portfolio,position,action){
  const settings=await globalNotificationSettingsForUser(env,userId);
  if(!settings.enabled||!settings.portfolio)return null;
  const entering=action==="added",ticker=trimText(position&&position.ticker,24).toUpperCase(),name=trimText(position&&position.name,160);
  const title=(entering?"Entrada en cartera · ":"Salida de cartera · ")+(ticker||name||"Posición");
  const message=(ticker||name||"La posición")+" "+(entering?"se ha añadido a ":"ha salido de ")+(portfolio&&portfolio.name||"la cartera")+".";
  const id=uid("al_"),now=nowIso();
  await env.DB.prepare("INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id,userId,position&&position.stock_key||"",ticker,name,entering?"portfolio-entry":"portfolio-exit","info",title,message,now).run();
  await dispatchPushAlert(env,{id,alert_type:entering?"portfolio-entry":"portfolio-exit",severity:"info",title,message},{user_id:userId,route:"portfolios",portfolio_id:portfolio&&portfolio.id||position&&position.portfolio_id||"",stock_key:position&&position.stock_key||"",ticker,prefer_tr:Number(position&&position.prefer_tr)===1?1:0});
  return id;
}

async function handlePositions(request, env, user, json, parts, url) {
  await ensurePositionBrokerSchema(env);
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const portfolioId = trimText(url.searchParams.get("portfolioId"), 80);
    let stmt = portfolioId
      ? env.DB.prepare("SELECT positions.*,(SELECT MAX(t.executed_at) FROM transactions t WHERE t.position_id=positions.id AND t.user_id=positions.user_id AND t.side='BUY') AS last_buy_at FROM positions WHERE user_id=? AND portfolio_id=? AND active=1 ORDER BY created_at DESC").bind(user.id, portfolioId)
      : env.DB.prepare("SELECT positions.*,(SELECT MAX(t.executed_at) FROM transactions t WHERE t.position_id=positions.id AND t.user_id=positions.user_id AND t.side='BUY') AS last_buy_at FROM positions WHERE user_id=? AND active=1 ORDER BY created_at DESC").bind(user.id);
    const rows = await stmt.all();
    return json({ positions: rows.results || [] });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = positionPayload(body);
    if (!data.portfolioId || !data.stockKey || !data.ticker) {
      return json({ error: "portfolioId, stockKey and ticker are required" }, 400);
    }
    const portfolio=await onePortfolio(env, user.id, data.portfolioId);
    if (!portfolio) return json({ error: "Portfolio not found" }, 404);
    data.broker=trimText(data.broker||portfolio.broker||(data.preferTr===1?"Trade Republic":""),80);
    const marketScope=normalizedMarketScope(portfolio.market_scope);
    if(marketScope==="tr"&&data.preferTr!==1)return json({error:"Esta cartera está configurada para Trade Republic / LSX."},409);
    if(marketScope==="us"&&data.preferTr===1)return json({error:"Esta cartera está configurada para mercado EEUU."},409);
    const existing = await env.DB.prepare(
      "SELECT * FROM positions WHERE user_id=? AND portfolio_id=? AND stock_key=? AND broker=? AND currency=? AND prefer_tr=? AND exchange=?"
    ).bind(user.id,data.portfolioId,data.stockKey,data.broker,data.currency,data.preferTr,data.exchange).first();
    const now = nowIso();
    let row=null;
    if(existing){
      // POST on an existing broker/listing is a new purchase, never a destructive overwrite.
      await ensureOpeningTransaction(env,user.id,existing);
      if(data.quantity===null||data.quantity<=0||data.avgPrice===null||data.avgPrice<0){
        return json({error:"quantity and avgPrice are required to add to an existing position"},400);
      }
      const txId=uid("tx_");
      const feeInfo=data.fees===null?await brokerFeeForTrade(env,user.id,data.broker,data.quantity,data.avgPrice,data.currency,"BUY",data.exchange):null;
      const fee=data.fees!==null?Math.max(0,data.fees):(feeInfo&&feeInfo.fee!==null?feeInfo.fee:null);
      if(fee===null)return json({error:"No se ha podido verificar todavía la comisión de este broker."},409);
      await env.DB.prepare(
        "INSERT INTO transactions (id,portfolio_id,user_id,position_id,broker,stock_key,ticker,name,exchange,isin,prefer_tr,side,quantity,price,fees,currency,executed_at,notes,origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'BUY',?,?,?,?,?,?,'manual',?,?)"
      ).bind(
        txId,data.portfolioId,user.id,existing.id,data.broker,data.stockKey,data.ticker,data.name,data.exchange,data.isin,
        data.preferTr,data.quantity,data.avgPrice,fee,data.currency,data.openedAt?new Date(data.openedAt).toISOString():now,data.notes||"",now,now
      ).run();
      const cashAdjustment=await adjustPortfolioCashForTransaction(
        env,user.id,data.portfolioId,data.currency,"BUY",data.quantity,data.avgPrice,fee,1,null,data.cashFxRate
      );
      await env.DB.prepare("UPDATE transactions SET cash_delta=?,cash_currency=?,updated_at=? WHERE id=? AND user_id=?")
        .bind(cashAdjustment.adjusted?(finiteNumber(cashAdjustment.delta)||0):0,cashAdjustment.adjusted?String(cashAdjustment.baseCurrency||data.currency):"",nowIso(),txId,user.id).run();
      const recalculated=await recalculatePositionFromTransactions(env,user.id,data.portfolioId,data.stockKey,existing.id);
      row=recalculated&&recalculated.position||existing;
    }else{
      const initialFeeInfo=data.fees===null?await brokerFeeForTrade(env,user.id,data.broker,data.quantity,data.avgPrice,data.currency,"BUY"):null;
      const initialFee=data.fees!==null?Math.max(0,data.fees):(initialFeeInfo&&initialFeeInfo.fee!==null?initialFeeInfo.fee:null);
      if(initialFee===null)return json({error:"No se ha podido verificar todavía la comisión de este broker."},409);
      const idNew=uid("pos_");
      await env.DB.prepare(
        "INSERT INTO positions (id,portfolio_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,quantity,avg_price,cost_basis,fees_total,currency,broker,opened_at,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)"
      ).bind(
        idNew,data.portfolioId,user.id,data.stockKey,data.ticker,data.name,data.exchange,data.isin,data.preferTr,
        data.quantity,data.avgPrice,data.quantity*data.avgPrice+initialFee,initialFee,data.currency,data.broker,data.openedAt,data.notes,now,now
      ).run();
      row=await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(idNew,user.id).first();
      row.opening_fee=initialFee;
      const seed=await ensureOpeningTransaction(env,user.id,row);
      if(seed&&seed.created){
        const cashAdjustment=await adjustPortfolioCashForTransaction(
          env,user.id,data.portfolioId,data.currency,"BUY",data.quantity,data.avgPrice,seed.fee,1,null,data.cashFxRate
        );
        await env.DB.prepare("UPDATE transactions SET cash_delta=?,cash_currency=?,updated_at=? WHERE id=? AND user_id=?")
          .bind(cashAdjustment.adjusted?(finiteNumber(cashAdjustment.delta)||0):0,cashAdjustment.adjusted?String(cashAdjustment.baseCurrency||data.currency):"",nowIso(),seed.id,user.id).run();
      }
      const recalculated=await recalculatePositionFromTransactions(env,user.id,data.portfolioId,data.stockKey,idNew);
      row=recalculated&&recalculated.position||row;
    }
    if(!existing||Number(existing.active)===0){
      try{await notifyPortfolioMembershipChange(env,user.id,portfolio,row,"added")}catch(error){console.warn("Portfolio entry notification failed",String(error&&error.message||error))}
    }
    return json({position:row,addedToExisting:!!existing},existing?200:201);
  }

  if (!id) return json({ error: "Position id required" }, 400);
  const existing = await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!existing) return json({ error: "Position not found" }, 404);

  // Congelar acciones: el Objetivo no propone vender, stops ni cambios sobre esa cantidad hasta la fecha.
  if (request.method === "POST" && parts[2] === "freeze") {
    const body = await readJson(request);
    const qty = finiteNumber(body.quantity) ?? 0, until = String(body.until || "").trim();
    const held = finiteNumber(existing.quantity) ?? 0;
    let frozenQty = 0, frozenUntil = null;
    if (qty > 0) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || !Number.isFinite(Date.parse(until + "T00:00:00Z"))) return json({ error: "Indica hasta qué fecha quedan congeladas." }, 400);
      if (until < serverFreezeFloorDate()) return json({ error: "La fecha tiene que ser hoy o posterior." }, 400);
      if (qty > held + 1e-9) return json({ error: "No puedes congelar más acciones de las que tienes." }, 400);
      frozenQty = Math.round(qty * 1e8) / 1e8; frozenUntil = until;
    }
    await env.DB.prepare("UPDATE positions SET frozen_qty=?,frozen_until=?,updated_at=? WHERE id=? AND user_id=?")
      .bind(frozenQty, frozenUntil, nowIso(), id, user.id).run();
    return json({ position: await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(id, user.id).first() });
  }

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const portfolioId = trimText(body.portfolioId !== undefined ? body.portfolioId : existing.portfolio_id, 80);
    const targetPortfolio=await onePortfolio(env, user.id, portfolioId);
    if (!targetPortfolio) return json({ error: "Portfolio not found" }, 404);
    const data = positionPayload({
      portfolioId,
      stockKey: existing.stock_key,
      ticker: body.ticker !== undefined ? body.ticker : existing.ticker,
      name: body.name !== undefined ? body.name : existing.name,
      exchange: body.exchange !== undefined ? body.exchange : existing.exchange,
      isin: body.isin !== undefined ? body.isin : existing.isin,
      preferTr: body.preferTr !== undefined ? body.preferTr : existing.prefer_tr,
      quantity: body.quantity !== undefined ? body.quantity : existing.quantity,
      avgPrice: body.avgPrice !== undefined ? body.avgPrice : existing.avg_price,
      currency: body.currency !== undefined ? body.currency : existing.currency,
      openedAt: body.openedAt !== undefined ? body.openedAt : existing.opened_at,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      broker: body.broker !== undefined ? body.broker : existing.broker
    });
    const targetScope=normalizedMarketScope(targetPortfolio.market_scope);
    if(targetScope==="tr"&&data.preferTr!==1)return json({error:"Esta cartera está configurada para Trade Republic / LSX."},409);
    if(targetScope==="us"&&data.preferTr===1)return json({error:"Esta cartera está configurada para mercado EEUU."},409);
    const adjusted=await appendPositionAdjustment(env,user.id,existing,data);
    const recalculated=adjusted
      ?await recalculatePositionFromTransactions(env,user.id,existing.portfolio_id,existing.stock_key,existing.id)
      :null;
    const ledger=recalculated&&recalculated.ledger;
    await env.DB.prepare(
      "UPDATE positions SET portfolio_id=?,ticker=?,name=?,exchange=?,isin=?,prefer_tr=?,quantity=?,avg_price=?,cost_basis=?,fees_total=?,currency=?,broker=?,opened_at=?,notes=?,last_analysis_at=NULL,last_signal=NULL,last_confidence=NULL,last_score=NULL,last_snapshot_id=NULL,updated_at=? WHERE id=? AND user_id=?"
    ).bind(
      data.portfolioId,data.ticker,data.name,data.exchange,data.isin,data.preferTr,data.quantity,
      data.avgPrice,ledger?ledger.invested:(finiteNumber(existing.cost_basis)??data.quantity*data.avgPrice),
      ledger?(ledger.totalFees||0):(finiteNumber(existing.fees_total)||0),
      data.currency,data.broker,data.openedAt,data.notes,nowIso(),id,user.id
    ).run();
    return json({ position: await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(id, user.id).first() });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE positions SET active=0,updated_at=? WHERE id=? AND user_id=?").bind(nowIso(), id, user.id).run();
    try{
      const portfolio=await onePortfolio(env,user.id,existing.portfolio_id);
      await notifyPortfolioMembershipChange(env,user.id,portfolio,existing,"removed");
    }catch(error){console.warn("Portfolio exit notification failed",String(error&&error.message||error))}
    return json({ deleted: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

// When a broker history arrives for a value, what the user had typed by hand for that
// same value in the same portfolio (manual buys, the initial «position seed», manual
// adjustments) describes the same shares twice. Retire it: delete those transactions,
// deactivate positions left empty and recalculate the rest.
async function retireManualEntries(env, userId, portfolioId, refs = null) {
  const rows = (await env.DB.prepare(
    "SELECT id,stock_key,isin,position_id,origin FROM transactions WHERE user_id=? AND portfolio_id=?"
  ).bind(userId, portfolioId).all()).results || [];
  const imported = new Set();
  for (const r of rows) if (String(r.origin || "").startsWith("import:")) {
    imported.add("K:" + String(r.stock_key || "").toUpperCase());
    if (r.isin) imported.add("I:" + String(r.isin).toUpperCase());
  }
  const wanted = refs ? new Set([...refs].map(x => String(x).toUpperCase())) : null;
  const hit = r => {
    const k = "K:" + String(r.stock_key || "").toUpperCase(), i = r.isin ? "I:" + String(r.isin).toUpperCase() : "";
    if (wanted) return wanted.has(k) || (i && wanted.has(i));
    return imported.has(k) || (i && imported.has(i));
  };
  const victims = rows.filter(r => !String(r.origin || "").startsWith("import:") && hit(r));
  if (!victims.length) return { removed: 0, positions: 0 };
  for (let i = 0; i < victims.length; i += 50) {
    await env.DB.batch(victims.slice(i, i + 50).map(v => env.DB.prepare("DELETE FROM transactions WHERE id=? AND user_id=?").bind(v.id, userId)));
  }
  const touched = new Map();
  for (const v of victims) touched.set(String(v.position_id || "") + "|" + v.stock_key, v);
  let positions = 0;
  const now = nowIso();
  for (const v of touched.values()) {
    const left = v.position_id
      ? await env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id=? AND position_id=?").bind(userId, v.position_id).first()
      : { n: 1 };
    if (v.position_id && !(Number(left && left.n) > 0)) {
      await env.DB.prepare("UPDATE positions SET active=0,quantity=0,updated_at=? WHERE id=? AND user_id=?").bind(now, v.position_id, userId).run();
      positions++;
    } else {
      try { await recalculatePositionFromTransactions(env, userId, portfolioId, v.stock_key, v.position_id || ""); } catch (_) {}
    }
  }
  // Positions created by hand without any transaction row (very old data).
  const orphan = (await env.DB.prepare(
    "SELECT p.id,p.stock_key,p.isin FROM positions p WHERE p.user_id=? AND p.portfolio_id=? AND p.active=1 AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id=p.user_id AND t.position_id=p.id)"
  ).bind(userId, portfolioId).all()).results || [];
  for (const o of orphan) {
    const covered = imported.has("K:" + String(o.stock_key || "").toUpperCase()) || (o.isin && imported.has("I:" + String(o.isin).toUpperCase()));
    if (!covered) continue;
    const has = await env.DB.prepare("SELECT COUNT(*) AS n FROM positions WHERE user_id=? AND portfolio_id=? AND stock_key=? AND active=1 AND id<>?").bind(userId, portfolioId, o.stock_key, o.id).first();
    if (Number(has && has.n) > 0) { await env.DB.prepare("UPDATE positions SET active=0,updated_at=? WHERE id=? AND user_id=?").bind(now, o.id, userId).run(); positions++; }
  }
  return { removed: victims.length, positions };
}

const IMPORT_MAX_ROWS = 80;

// Batch import from a broker export or sync. Rows arrive already matched to the
// catalogue by the app (stockKey/ticker/ISIN) and sorted; each one carries the
// broker's execution id, so re-importing is idempotent.
async function handleTransactionImport(request, env, user, json) {
  const body = await readJson(request);
  const portfolioId = trimText(body.portfolioId, 80);
  const source = ["tr","ibkr","csv","backup"].includes(String(body.source||"")) ? String(body.source) : "csv";
  const broker = trimText(body.broker, 80);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, IMPORT_MAX_ROWS) : [];
  if (!portfolioId || !rows.length) return json({ error: "portfolioId and rows are required" }, 400);
  if (!(await onePortfolio(env, user.id, portfolioId))) return json({ error: "Portfolio not found" }, 404);
  const ordered = rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const ta = Date.parse(a.row && a.row.executedAt) || 0, tb = Date.parse(b.row && b.row.executedAt) || 0;
    if (ta !== tb) return ta - tb;
    const sa = String(a.row && a.row.side).toUpperCase() === "BUY" ? 0 : 1, sb = String(b.row && b.row.side).toUpperCase() === "BUY" ? 0 : 1;
    return sa - sb || a.index - b.index;
  });
  let imported = 0, skipped = 0, retired = { removed: 0, positions: 0 };
  const errors = [];
  if (body.replaceManual === true && source !== "backup") {
    const refs = new Set();
    for (const r of rows) {
      if (r && r.stockKey) refs.add("K:" + String(r.stockKey).toUpperCase());
      if (r && r.isin) refs.add("I:" + String(r.isin).toUpperCase());
    }
    retired = await retireManualEntries(env, user.id, portfolioId, refs);
  }
  for (const { row } of ordered) {
    const externalId = trimText(row && row.externalId, 120);
    if (!externalId) { errors.push({ externalId: "", error: "Falta el identificador de la operación" }); continue; }
    const existing = await env.DB.prepare("SELECT id FROM transactions WHERE user_id=? AND external_id=? LIMIT 1").bind(user.id, externalId).first();
    if (existing) { skipped++; continue; }
    // Restoring a backup into the account it came from: the original row is still there.
    const originalId = source === "backup" ? trimText(row && row.originalId, 80) : "";
    if (originalId && await env.DB.prepare("SELECT id FROM transactions WHERE user_id=? AND id=? LIMIT 1").bind(user.id, originalId).first()) { skipped++; continue; }
    const data = transactionPayload({ ...row, portfolioId, broker: broker || row.broker, positionId: "" });
    try {
      const result = await createTransactionRecord(env, user, data, {
        origin: "import:" + source, externalId, adjustCash: body.adjustCash === true, defaultFees: 0
      });
      if (result.status >= 400) errors.push({ externalId, ticker: data.ticker, error: String(result.body && result.body.error || "Error") });
      else imported++;
    } catch (error) {
      if (/UNIQUE/i.test(String(error && error.message))) skipped++;
      else errors.push({ externalId, ticker: data.ticker, error: "No se pudo guardar (" + String(error && error.message || "error").replace(/^D1_ERROR:\s*/i, "").slice(0, 90) + ")" });
    }
  }
  return json({ imported, skipped, errors, retired });
}

// Interactive Brokers Flex Web Service (official, read-only). The token and query id
// come from the app on each call and are never stored or logged here.
const IBKR_FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

function flexAttr(tag, name) {
  const m = tag.match(new RegExp("\\s" + name + "=\"([^\"]*)\""));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "";
}
function flexTag(xml, name) {
  const m = xml.match(new RegExp("<" + name + ">([^<]*)</" + name + ">"));
  return m ? m[1].trim() : "";
}
function flexDateIso(value) {
  const m = String(value || "").match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[;,\s T]+(\d{2}):?(\d{2}):?(\d{2})?)?/);
  if (!m) return "";
  // Flex reports exchange-local time without a zone; New York covers US listings.
  const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 16), +(m[5] || 0), +(m[6] || 0));
  const probe = new Date(local);
  const offset = (() => {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(probe).map(p => [p.type, p.value]));
      const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
      return asUtc - probe.getTime();
    } catch (_) { return -4 * 3600e3; }
  })();
  return new Date(local - offset).toISOString();
}
function parseFlexTrades(xml) {
  const out = [];
  for (const tag of xml.match(/<Trade\s[^>]*?\/?>/g) || []) {
    const category = flexAttr(tag, "assetCategory");
    if (category && category !== "STK" && category !== "FUND" && category !== "ETF") continue;
    const side = flexAttr(tag, "buySell").toUpperCase().replace(/\s.*$/, "");
    if (side !== "BUY" && side !== "SELL") continue;
    const quantity = Math.abs(Number(flexAttr(tag, "quantity")));
    const price = Number(flexAttr(tag, "tradePrice"));
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price)) continue;
    const id = flexAttr(tag, "tradeID") || flexAttr(tag, "transactionID") || flexAttr(tag, "ibExecID");
    if (!id) continue;
    out.push({
      externalId: "ibkr:" + id,
      side, quantity, price,
      fees: Math.abs(Number(flexAttr(tag, "ibCommission")) || 0),
      feeCurrency: flexAttr(tag, "ibCommissionCurrency").toUpperCase(),
      currency: flexAttr(tag, "currency").toUpperCase() || "USD",
      symbol: flexAttr(tag, "symbol").toUpperCase(),
      isin: flexAttr(tag, "isin").toUpperCase(),
      name: flexAttr(tag, "description"),
      exchange: flexAttr(tag, "listingExchange").toUpperCase() || flexAttr(tag, "exchange").toUpperCase(),
      executedAt: flexDateIso(flexAttr(tag, "dateTime") || flexAttr(tag, "tradeDate")),
      account: flexAttr(tag, "accountId")
    });
  }
  return out;
}
// Dividends and their withholding from the Flex «Cash Transactions» section. IBKR books
// the dividend and the tax as separate rows sharing actionID (or ISIN + day).
export function parseFlexDividends(xml) {
  const groups = new Map();
  for (const tag of String(xml || "").match(/<CashTransaction\s[^>]*?\/?>/g) || []) {
    const type = flexAttr(tag, "type").toLowerCase();
    const isDividend = /dividend/.test(type) && !/withholding/.test(type);
    const isTax = /withholding tax/.test(type);
    if (!isDividend && !isTax) continue;
    const level = flexAttr(tag, "levelOfDetail").toUpperCase();
    if (level && level !== "DETAIL") continue;
    const amount = Number(flexAttr(tag, "amount"));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const isin = flexAttr(tag, "isin").toUpperCase(), symbol = flexAttr(tag, "symbol").toUpperCase();
    const when = flexAttr(tag, "dateTime") || flexAttr(tag, "settleDate") || flexAttr(tag, "reportDate");
    // Payment date as booked by IBKR (no time-zone shift: a 20:20 New York entry is that day).
    const dm = String(when || "").match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    if (!dm) continue;
    const day = dm[1] + "-" + dm[2] + "-" + dm[3];
    const currency = flexAttr(tag, "currency").toUpperCase() || "USD";
    const actionId = flexAttr(tag, "actionID");
    const key = (actionId ? "a" + actionId : (isin || symbol) + ":" + day) + ":" + currency;
    const g = groups.get(key) || { key, isin, symbol, name: "", currency, day, gross: 0, withholding: 0 };
    if (isDividend) { g.gross += amount; g.name = g.name || flexAttr(tag, "description"); }
    else g.withholding -= amount; // tax rows are negative; refunds positive
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    if (!(g.gross > 0)) continue;
    out.push({
      externalId: "ibkr-div:" + g.key,
      paidAt: g.day + "T12:00:00.000Z", isin: g.isin, ticker: g.symbol, name: g.name.replace(/\s*\(.*$/, "").slice(0, 160),
      currency: g.currency, gross: Math.round(g.gross * 1e4) / 1e4, withholding: Math.max(0, Math.round(g.withholding * 1e4) / 1e4)
    });
  }
  return out.sort((a, b) => a.paidAt.localeCompare(b.paidAt));
}
function parseFlexPositions(xml) {
  const out = [];
  for (const tag of xml.match(/<OpenPosition\s[^>]*?\/?>/g) || []) {
    const quantity = Number(flexAttr(tag, "position"));
    if (!Number.isFinite(quantity) || quantity === 0) continue;
    out.push({
      symbol: flexAttr(tag, "symbol").toUpperCase(), isin: flexAttr(tag, "isin").toUpperCase(),
      quantity, currency: flexAttr(tag, "currency").toUpperCase(),
      costPrice: Number(flexAttr(tag, "costBasisPrice")) || null, name: flexAttr(tag, "description")
    });
  }
  return out;
}

async function handleBrokerSync(request, env, user, json, parts) {
  if (request.method !== "POST" || parts[1] !== "ibkr") return json({ error: "Unknown broker sync" }, 404);
  const body = await readJson(request);
  const token = String(body.token || "").trim(), queryId = String(body.queryId || "").trim();
  if (!/^[A-Za-z0-9]{10,64}$/.test(token)) return json({ error: "El token Flex no tiene un formato válido." }, 400);
  if (!/^\d{3,12}$/.test(queryId)) return json({ error: "El Query ID debe ser numérico." }, 400);
  const headers = { "User-Agent": "ViewInvAI/1.0 (Flex Web Service client)" };
  const send = await fetch(IBKR_FLEX_BASE + "/SendRequest?t=" + encodeURIComponent(token) + "&q=" + encodeURIComponent(queryId) + "&v=3", { headers });
  const sendXml = await send.text();
  if (flexTag(sendXml, "Status") !== "Success") {
    return json({ error: "IBKR rechazó la petición: " + (flexTag(sendXml, "ErrorMessage") || "respuesta inesperada") + ".", code: flexTag(sendXml, "ErrorCode") }, 502);
  }
  const reference = flexTag(sendXml, "ReferenceCode");
  const statementUrl = flexTag(sendXml, "Url") || (IBKR_FLEX_BASE + "/GetStatement");
  if (!/^https:\/\/[a-z0-9.-]*interactivebrokers\.com\//i.test(statementUrl)) return json({ error: "IBKR devolvió una URL no esperada." }, 502);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 2500));
    const res = await fetch(statementUrl + "?t=" + encodeURIComponent(token) + "&q=" + encodeURIComponent(reference) + "&v=3", { headers });
    const xml = await res.text();
    if (/<FlexQueryResponse/.test(xml)) {
      return json({ trades: parseFlexTrades(xml), positions: parseFlexPositions(xml), dividends: parseFlexDividends(xml), fetchedAt: nowIso() });
    }
    const code = flexTag(xml, "ErrorCode");
    if (code === "1019" || code === "1021") continue; // statement still being generated
    return json({ error: "IBKR: " + (flexTag(xml, "ErrorMessage") || "no se pudo obtener el informe") + ".", code }, 502);
  }
  return json({ error: "IBKR sigue generando el informe. Vuelve a intentarlo en un minuto." }, 504);
}

/* ---------------- Fiscalidad España (IRPF) ----------------
 * FIFO por valor homogéneo (mismo ISIN en todas las cuentas del usuario), importes en
 * EUR con el tipo de referencia del BCE del día de cada operación, comisiones dentro
 * del coste y de la transmisión, y la regla de los dos meses (art. 33.5.f LIRPF) para
 * pérdidas con recompra de valores homogéneos. Es un cálculo orientativo.
 */
async function ensureFxSchema(env){
  const schemaKey="fx:"+cacheDbLabel(env.DB);
  if(cacheSchemaReady.has(schemaKey))return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fx_rates (currency TEXT NOT NULL,date TEXT NOT NULL,rate REAL NOT NULL CHECK(rate>0),PRIMARY KEY(currency,date))").run();
  cacheSchemaReady.add(schemaKey);
}
const isoDay=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):""};
// Datos no personales: viven en la base de caché (Turso) con vuelta a D1 si falla.
const onCacheDb=(env,fn)=>withCacheDb(env,db=>fn(db===env.DB?env:{...env,DB:db,D1_PRIMARY:env.DB}));
async function loadEcbRates(env,...args){return onCacheDb(env,e=>loadEcbRatesOn(e,...args))}
async function loadEcbRatesOn(env,currency,fromDay,toDay){
  await ensureFxSchema(env);
  const cached=await env.DB.prepare("SELECT date,rate FROM fx_rates WHERE currency=? AND date>=? AND date<=? ORDER BY date").bind(currency,fromDay,toDay).all();
  const rows=cached.results||[];
  const today=isoDay(Date.now());
  const lastCached=rows.length?rows[rows.length-1].date:"";
  const span=(Date.parse(toDay)-Date.parse(fromDay))/864e5;
  // ECB publishes ~250 rates a year; refetch when coverage is clearly incomplete.
  const complete=rows.length>=Math.max(1,Math.floor(span*0.62))&&(lastCached>=toDay||Date.parse(toDay)-Date.parse(lastCached)<5*864e5||toDay>=today&&Date.parse(today)-Date.parse(lastCached)<4*864e5);
  if(complete)return rows;
  const url="https://data-api.ecb.europa.eu/service/data/EXR/D."+encodeURIComponent(currency)+".EUR.SP00.A?startPeriod="+fromDay+"&endPeriod="+toDay+"&format=csvdata";
  const res=await fetch(url,{headers:{"Accept":"text/csv","User-Agent":"ViewInvAI/1.0 tax-report"}});
  if(!res.ok)return rows;
  const lines=(await res.text()).split(/\r?\n/).filter(Boolean);
  if(lines.length<2)return rows;
  const head=lines[0].split(","),iDate=head.indexOf("TIME_PERIOD"),iVal=head.indexOf("OBS_VALUE");
  const fresh=[];
  for(const line of lines.slice(1)){
    const cols=line.split(",");const date=cols[iDate],rate=Number(cols[iVal]);
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&rate>0)fresh.push({date,rate});
  }
  if(fresh.length)await writeChangedDailyRows(env,"fx_rates","currency",currency,"rate",fresh.map(r=>({date:r.date,value:r.rate})));
  return fresh.length?fresh:rows;
}
// Cuota de D1 (100k filas escritas/día): un histórico descargado de nuevo trae casi siempre los
// mismos cierres. Solo se escriben los días que faltan o cuyo valor ha cambiado (el último cierre
// del día en curso); reescribirlo entero con INSERT OR REPLACE costaba miles de filas por apertura.
async function writeChangedDailyRows(env,table,keyColumn,key,valueColumn,rows){
  if(!rows.length)return 0;
  const first=rows.reduce((m,r)=>r.date<m?r.date:m,rows[0].date);
  const existing=await env.DB.prepare("SELECT date,"+valueColumn+" AS value FROM "+table+" WHERE "+keyColumn+"=? AND date>=?").bind(key,first).all();
  const have=new Map((existing.results||[]).map(r=>[String(r.date),Number(r.value)]));
  const changed=rows.filter(r=>{
    const old=have.get(r.date);
    return old===undefined||!(Math.abs(old-r.value)<=Math.abs(old)*1e-7);
  });
  for(let i=0;i<changed.length;i+=90){
    await env.DB.batch(changed.slice(i,i+90).map(r=>env.DB.prepare(
      "INSERT INTO "+table+" ("+keyColumn+",date,"+valueColumn+") VALUES (?,?,?) ON CONFLICT("+keyColumn+",date) DO UPDATE SET "+valueColumn+"="+"excluded."+valueColumn
    ).bind(key,r.date,r.value)));
  }
  return changed.length;
}
function fxLookup(rows){
  const sorted=rows.slice().sort((a,b)=>a.date<b.date?-1:1);
  return day=>{
    let lo=0,hi=sorted.length-1,hit=null;
    while(lo<=hi){const mid=(lo+hi)>>1;if(sorted[mid].date<=day){hit=sorted[mid];lo=mid+1}else hi=mid-1}
    if(hit&&(Date.parse(day)-Date.parse(hit.date))/864e5<=10)return hit;
    return null;
  };
}
function addMonths(day,months){const d=new Date(day+"T12:00:00Z");d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10)}

export function computeSpanishTax(rows,fxFor,year){
  const securities=new Map();
  const warnings=new Set();
  const keyOf=row=>String(row.isin||"").trim().toUpperCase()||String(row.stock_key||"").toUpperCase();
  const ordered=(rows||[]).slice().sort((a,b)=>String(a.executed_at).localeCompare(String(b.executed_at))||(String(a.side)==="BUY"?-1:1));
  const toEur=(amount,currency,day)=>{
    currency=String(currency||"EUR").toUpperCase();
    if(currency==="EUR")return{eur:amount,rate:1};
    const hit=fxFor(currency,day);
    if(!hit){warnings.add("Sin tipo BCE para "+currency+" el "+day);return{eur:null,rate:null}}
    return{eur:amount/hit.rate,rate:hit.rate,rateDate:hit.date};
  };
  const sales=[];
  for(const row of ordered){
    const qty=Number(row.quantity),price=Number(row.price),fees=Math.max(0,Number(row.fees)||0);
    if(!(qty>0)||!(price>=0))continue;
    const key=keyOf(row);if(!key)continue;
    const day=isoDay(row.executed_at);if(!day)continue;
    if(!securities.has(key))securities.set(key,{key,ticker:row.ticker,name:row.name,isin:String(row.isin||"").toUpperCase(),lots:[],buys:[]});
    const sec=securities.get(key);
    const origin=String(row.origin||"");
    const side=String(row.side||"").toUpperCase();
    if(origin==="position-adjustment"){
      const total=toEur(qty*price,row.currency,day);
      sec.lots=[{day,qty,costEur:total.eur,broker:row.broker||"",adjusted:true}];
      warnings.add(sec.ticker+": posición ajustada a mano; el coste fiscal parte de ese ajuste.");
      continue;
    }
    if(side==="BUY"){
      const gross=toEur(qty*price+fees,row.currency,day);
      sec.lots.push({day,qty,costEur:gross.eur,broker:row.broker||""});
      sec.buys.push({day,qty});
      continue;
    }
    if(side!=="SELL")continue;
    const net=toEur(qty*price-fees,row.currency,day);
    let remaining=qty,costEur=0,costKnown=net.eur!==null;
    const used=[];
    while(remaining>1e-9&&sec.lots.length){
      const lot=sec.lots[0],take=Math.min(lot.qty,remaining);
      const part=lot.costEur===null?null:lot.costEur*take/lot.qty;
      if(part===null)costKnown=false;else costEur+=part;
      used.push({day:lot.day,qty:take,costEur:part,broker:lot.broker});
      lot.costEur=lot.costEur===null?null:lot.costEur-(part||0);lot.qty-=take;remaining-=take;
      if(lot.qty<=1e-9)sec.lots.shift();
    }
    if(remaining>1e-9){warnings.add(sec.ticker+": se venden más títulos de los registrados; falta historial de compras.");costKnown=false}
    sales.push({sec,row,day,qty,proceedsEur:net.eur,costEur:costKnown?costEur:null,used,currency:String(row.currency||"EUR").toUpperCase(),fxRate:net.rate,price,fees});
  }
  // Two-month rule: loss with homogeneous securities bought within ±2 months that are
  // not the ones being sold.
  const out=[];
  for(const sale of sales){
    if(!sale.day.startsWith(String(year)))continue;
    const gain=sale.proceedsEur!==null&&sale.costEur!==null?sale.proceedsEur-sale.costEur:null;
    let blockedQty=0;
    if(gain!==null&&gain<0){
      const from=addMonths(sale.day,-2),to=addMonths(sale.day,2);
      const inWindow=d=>d>=from&&d<=to;
      const bought=sale.sec.buys.filter(b=>inWindow(b.day)).reduce((a,b)=>a+b.qty,0);
      const soldFromWindow=sale.used.filter(u=>inWindow(u.day)).reduce((a,u)=>a+u.qty,0);
      blockedQty=Math.max(0,Math.min(sale.qty,bought-soldFromWindow));
    }
    const blockedLoss=gain!==null&&gain<0?gain*blockedQty/sale.qty:0;
    out.push({
      ticker:sale.sec.ticker,name:sale.sec.name,isin:sale.sec.isin,date:sale.day,quantity:sale.qty,
      currency:sale.currency,price:sale.price,fees:sale.fees,fxRate:sale.fxRate,
      proceedsEur:sale.proceedsEur,costEur:sale.costEur,gainEur:gain,
      blockedLossEur:blockedLoss,blockedQty,computableEur:gain===null?null:gain-blockedLoss,
      lots:sale.used.map(u=>({date:u.day,quantity:u.qty,costEur:u.costEur,broker:u.broker})),
      broker:sale.row.broker||""
    });
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));
  const sum=f=>out.reduce((a,x)=>a+(Number(f(x))||0),0);
  const totals={
    proceedsEur:sum(x=>x.proceedsEur),costEur:sum(x=>x.costEur),
    gainsEur:sum(x=>x.computableEur>0?x.computableEur:0),
    lossesEur:sum(x=>x.computableEur<0?x.computableEur:0),
    blockedLossEur:sum(x=>x.blockedLossEur),
    netEur:sum(x=>x.computableEur),
    sales:out.length,incomplete:out.filter(x=>x.gainEur===null).length
  };
  // Holdings on 31 December (or today for the current year), at cost, by broker.
  const holdings=[];
  for(const sec of securities.values()){
    const qty=sec.lots.reduce((a,l)=>a+l.qty,0);
    if(qty<=1e-9)continue;
    const byBroker={};
    for(const l of sec.lots){const b=l.broker||"Sin bróker";byBroker[b]=byBroker[b]||{qty:0,costEur:0};byBroker[b].qty+=l.qty;byBroker[b].costEur+=l.costEur||0}
    holdings.push({ticker:sec.ticker,name:sec.name,isin:sec.isin,key:sec.key,quantity:qty,costEur:sec.lots.reduce((a,l)=>a+(l.costEur||0),0),byBroker});
  }
  return{year:Number(year),sales:out,totals,holdings,warnings:[...warnings]};
}

async function handleTaxReport(request,env,user,json,url){
  if(request.method!=="GET")return json({error:"Method not allowed"},405);
  await ensureTransactionsSchema(env);
  const nowYear=new Date().getUTCFullYear();
  const year=Math.max(2000,Math.min(nowYear,Math.round(finiteNumber(url.searchParams.get("year"))||nowYear)));
  const cutoff=year<nowYear?(year+1)+"-01-01T00:00:00.000Z":new Date(Date.now()+864e5).toISOString();
  const res=await env.DB.prepare("SELECT ticker,name,isin,stock_key,side,quantity,price,fees,currency,executed_at,origin,broker FROM transactions WHERE user_id=? AND executed_at<? ORDER BY executed_at ASC,created_at ASC").bind(user.id,cutoff).all();
  const rows=res.results||[];
  const needed=new Map();
  for(const r of rows){
    const c=String(r.currency||"EUR").toUpperCase();if(c==="EUR")continue;
    const d=isoDay(r.executed_at);if(!d)continue;
    const cur=needed.get(c)||{from:d,to:d};if(d<cur.from)cur.from=d;if(d>cur.to)cur.to=d;needed.set(c,cur);
  }
  await ensureDividendsSchema(env);
  const divRes=await env.DB.prepare("SELECT id,paid_at,isin,ticker,name,currency,gross,withholding,withholding_es,origin,broker FROM dividends WHERE user_id=? AND paid_at>=? AND paid_at<? ORDER BY paid_at ASC").bind(user.id,year+"-01-01",(year+1)+"-01-01").all();
  const divRows=divRes.results||[];
  for(const r of divRows){
    const c=String(r.currency||"EUR").toUpperCase();if(c==="EUR")continue;
    const d=isoDay(r.paid_at);if(!d)continue;
    const cur=needed.get(c)||{from:d,to:d};if(d<cur.from)cur.from=d;if(d>cur.to)cur.to=d;needed.set(c,cur);
  }
  const lookups={};
  for(const [currency,range] of needed){
    if(!/^[A-Z]{3}$/.test(currency))continue;
    const from=new Date(Date.parse(range.from)-12*864e5).toISOString().slice(0,10);
    try{lookups[currency]=fxLookup(await loadEcbRates(env,currency,from,range.to))}catch(_){lookups[currency]=()=>null}
  }
  const fxFor=(c,d)=>lookups[c]?lookups[c](d):null;
  const report=computeSpanishTax(rows,fxFor,year);
  report.dividends=computeDividendTax(divRows,fxFor);
  report.savings=savingsTaxEstimate(report.totals.netEur,report.dividends.totals.grossEur);
  report.savings.deductionEur=report.dividends.totals.deductibleEur;
  report.savings.withheldEsEur=report.dividends.totals.withholdingEsEur;
  report.savings.dueEur=Math.max(0,report.savings.taxEur-report.savings.deductionEur)-report.savings.withheldEsEur;
  report.asOf=year<nowYear?year+"-12-31":isoDay(Date.now());
  report.transactions=rows.length;
  return json(report);
}

/* ---------------- Copia de seguridad ----------------
 * Todo lo que el usuario ha introducido, en un JSON descargable: carteras, posiciones,
 * operaciones, dividendos, favoritos sincronizados, avisos por valor y preferencias.
 * Nunca incluye tokens ni credenciales (el token de IBKR vive solo en el dispositivo).
 */
async function handleBackup(request,env,user,json){
  if(request.method!=="GET")return json({error:"Method not allowed"},405);
  await ensureTransactionsSchema(env);
  await ensureDividendsSchema(env);
  await ensureNotificationPreferenceSchema(env);
  await ensureUiPreferencesSchema(env);
  await ensurePositionBrokerSchema(env);
  const all=async(sql)=>{try{return(await env.DB.prepare(sql).bind(user.id).all()).results||[]}catch(_){return[]}};
  const [portfolios,positions,transactions,dividends,watchlist,notificationPreferences,uiPreferences]=await Promise.all([
    all("SELECT id,name,broker,base_currency,cash_balance,sort_order,created_at FROM portfolios WHERE user_id=? ORDER BY sort_order,created_at"),
    all("SELECT id,portfolio_id,stock_key,ticker,name,exchange,isin,prefer_tr,quantity,avg_price,currency,broker,opened_at,active,frozen_qty,frozen_until FROM positions WHERE user_id=?"),
    all("SELECT id,portfolio_id,position_id,broker,stock_key,ticker,name,exchange,isin,prefer_tr,side,quantity,price,fees,currency,executed_at,notes,origin,external_id FROM transactions WHERE user_id=? ORDER BY executed_at,created_at"),
    all("SELECT id,portfolio_id,external_id,paid_at,isin,ticker,name,currency,gross,withholding,withholding_es,origin,broker FROM dividends WHERE user_id=? ORDER BY paid_at"),
    all("SELECT stock_key,ticker,name,exchange,isin,prefer_tr,notes FROM watchlist WHERE user_id=?"),
    all("SELECT stock_key,ticker,name,prefer_tr,news_enabled,pulse_enabled,radar_enabled,price_up_enabled,price_down_enabled,price_up_step,price_down_step,price_above,price_below FROM notification_preferences WHERE user_id=?"),
    all("SELECT scope,preferences_json FROM user_ui_preferences WHERE user_id=?")
  ]);
  const prefs={};
  for(const r of uiPreferences){try{prefs[r.scope]=JSON.parse(r.preferences_json||"{}")}catch(_){}}
  return json({app:"ViewInvAI",kind:"backup",version:1,exportedAt:nowIso(),portfolios,positions,transactions,dividends,watchlist,notificationPreferences,uiPreferences:prefs},200,{"Cache-Control":"no-store"});
}

/* ---------------- Dividendos y retenciones ----------------
 * Cobros de dividendos con su retención en origen (y la española si la hubo). Se
 * importan de Trade Republic (CSV) e IBKR (Flex · Cash Transactions) o se añaden a mano;
 * el external_id evita duplicados al reimportar.
 */
let dividendsSchemaReady=false;
async function ensureDividendsSchema(env){
  if(dividendsSchemaReady)return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS dividends (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,portfolio_id TEXT NOT NULL DEFAULT '',external_id TEXT,paid_at TEXT NOT NULL,isin TEXT NOT NULL DEFAULT '',ticker TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',currency TEXT NOT NULL DEFAULT 'EUR',gross REAL NOT NULL CHECK(gross>0),withholding REAL NOT NULL DEFAULT 0 CHECK(withholding>=0),withholding_es REAL NOT NULL DEFAULT 0 CHECK(withholding_es>=0),origin TEXT NOT NULL DEFAULT 'manual',broker TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_dividends_external ON dividends(user_id,external_id) WHERE external_id IS NOT NULL"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_dividends_user_date ON dividends(user_id,paid_at)")
  ]);
  dividendsSchemaReady=true;
}
function dividendFromBody(body){
  const positive=v=>{if(v===null||v===undefined||v==="")return null;const n=finiteNumber(v);return n!==null&&n>=0?n:null};
  const paid=new Date(String(body.paidAt||body.date||""));
  if(!Number.isFinite(paid.getTime()))return{error:"Fecha de cobro no válida."};
  const gross=positive(body.gross);
  if(!(gross>0)||gross>1e8)return{error:"El importe bruto debe ser mayor que 0."};
  const withholding=positive(body.withholding)||0,withholdingEs=positive(body.withholdingEs)||0;
  if(withholding+withholdingEs>gross+1e-9)return{error:"La retención no puede superar el importe bruto."};
  const currency=trimText(body.currency||"EUR",3).toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))return{error:"Divisa no válida."};
  const isin=trimText(body.isin,12).toUpperCase();
  if(isin&&!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))return{error:"ISIN no válido."};
  const ticker=trimText(body.ticker,24).toUpperCase(),name=trimText(body.name,160);
  if(!isin&&!ticker&&!name)return{error:"Indica el valor (ISIN, ticker o nombre)."};
  // Spanish issuers: the withholding is a Spanish retention (creditable), not foreign tax.
  const es=isin.startsWith("ES");
  return{
    paidAt:paid.toISOString(),gross,currency,isin,ticker,name,
    withholding:es?0:withholding,withholdingEs:es?withholding+withholdingEs:withholdingEs,
    externalId:trimText(body.externalId,160)||null,
    portfolioId:trimText(body.portfolioId,80),broker:trimText(body.broker,80),origin:trimText(body.origin||"manual",24)
  };
}
async function insertDividend(env,userId,d){
  const res=await env.DB.prepare("INSERT OR IGNORE INTO dividends (id,user_id,portfolio_id,external_id,paid_at,isin,ticker,name,currency,gross,withholding,withholding_es,origin,broker,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(uid("dv_"),userId,d.portfolioId||"",d.externalId,d.paidAt,d.isin,d.ticker,d.name,d.currency,d.gross,d.withholding,d.withholdingEs,d.origin,d.broker,nowIso()).run();
  return Number(res&&res.meta&&res.meta.changes)>0;
}
async function handleDividends(request,env,user,json,parts,url){
  await ensureDividendsSchema(env);
  if(request.method==="GET"){
    const y=Math.round(finiteNumber(url.searchParams.get("year"))||new Date().getUTCFullYear());
    const rows=await env.DB.prepare("SELECT id,portfolio_id,paid_at,isin,ticker,name,currency,gross,withholding,withholding_es,origin,broker FROM dividends WHERE user_id=? AND paid_at>=? AND paid_at<? ORDER BY paid_at DESC").bind(user.id,y+"-01-01",(y+1)+"-01-01").all();
    return json({year:y,dividends:rows.results||[]});
  }
  if(request.method==="POST"&&parts[1]==="import"){
    const body=await readJson(request),rows=Array.isArray(body.rows)?body.rows:[];
    if(rows.length>300)return json({error:"Máximo 300 dividendos por lote."},413);
    const portfolioId=trimText(body.portfolioId,80);
    if(portfolioId&&!(await onePortfolio(env,user.id,portfolioId)))return json({error:"Portfolio not found"},404);
    let imported=0,skipped=0;const errors=[];
    for(const raw of rows){
      const d=dividendFromBody(Object.assign({},raw,{portfolioId,broker:body.broker,origin:body.source||"import"}));
      if(d.error){errors.push({ticker:raw&&(raw.ticker||raw.isin)||"",error:d.error});continue}
      if(!d.externalId){errors.push({ticker:d.ticker||d.isin,error:"Falta el identificador del bróker."});continue}
      const originalId=String(body.source||"")==="backup"?trimText(raw&&raw.originalId,80):"";
      if(originalId&&await env.DB.prepare("SELECT id FROM dividends WHERE user_id=? AND id=?").bind(user.id,originalId).first()){skipped++;continue}
      if(await insertDividend(env,user.id,d))imported++;else skipped++;
    }
    return json({imported,skipped,errors:errors.slice(0,20)});
  }
  if(request.method==="POST"){
    const d=dividendFromBody(await readJson(request));
    if(d.error)return json({error:d.error},400);
    if(d.portfolioId&&!(await onePortfolio(env,user.id,d.portfolioId)))return json({error:"Portfolio not found"},404);
    d.externalId=null;d.origin="manual";
    await insertDividend(env,user.id,d);
    return json({ok:true},201);
  }
  if(request.method==="DELETE"&&parts[1]){
    const r=await env.DB.prepare("DELETE FROM dividends WHERE id=? AND user_id=?").bind(trimText(parts[1],80),user.id).run();
    return json({deleted:Number(r&&r.meta&&r.meta.changes)>0});
  }
  return json({error:"Method not allowed"},405);
}

// Withholding the Spanish tax office lets you deduct (art. 80 LIRPF): what was paid abroad,
// capped at the treaty rate. Most Spanish treaties cap dividends at 15%; Ireland and the
// UK do not withhold. Anything above the cap has to be reclaimed in the source country.
const DIVIDEND_TREATY_CAP={US:.15,DE:.15,FR:.15,NL:.15,CH:.15,CA:.15,IT:.15,BE:.15,AT:.15,DK:.15,SE:.15,NO:.15,FI:.15,JP:.15,AU:.15,PT:.15,LU:.15,GB:0,IE:0};
export function computeDividendTax(rows,fxFor){
  const warnings=new Set(),items=[],byCountry={};
  for(const r of rows||[]){
    const day=isoDay(r.paid_at);if(!day)continue;
    const currency=String(r.currency||"EUR").toUpperCase();
    let rate=1;
    if(currency!=="EUR"){const hit=fxFor(currency,day);if(!hit){warnings.add("Sin tipo BCE para "+currency+" el "+day);continue}rate=hit.rate}
    const gross=Number(r.gross)/rate,wht=(Number(r.withholding)||0)/rate,whtEs=(Number(r.withholding_es)||0)/rate;
    const country=/^[A-Z]{2}/.test(String(r.isin||""))?String(r.isin).slice(0,2).toUpperCase():"";
    const cap=country==="ES"?0:(DIVIDEND_TREATY_CAP[country]??.15);
    const deductible=Math.min(wht,gross*cap);
    const excess=Math.max(0,wht-deductible);
    if(wht>0&&!country)warnings.add((r.ticker||r.name||"Un dividendo")+": sin ISIN, se aplica el límite general del 15 %.");
    items.push({id:r.id,date:day,ticker:r.ticker,name:r.name,isin:r.isin,country,currency,fxRate:rate,
      grossEur:gross,withholdingEur:wht,withholdingEsEur:whtEs,deductibleEur:deductible,excessEur:excess,
      netEur:gross-wht-whtEs,broker:r.broker||"",origin:r.origin||""});
    const c=byCountry[country||"—"]=byCountry[country||"—"]||{country:country||"—",grossEur:0,withholdingEur:0,deductibleEur:0,excessEur:0,cap};
    c.grossEur+=gross;c.withholdingEur+=wht;c.deductibleEur+=deductible;c.excessEur+=excess;
  }
  const sum=k=>items.reduce((a,x)=>a+x[k],0);
  return{
    items:items.sort((a,b)=>b.date.localeCompare(a.date)),
    byCountry:Object.values(byCountry).sort((a,b)=>b.grossEur-a.grossEur),
    totals:{grossEur:sum("grossEur"),withholdingEur:sum("withholdingEur"),withholdingEsEur:sum("withholdingEsEur"),deductibleEur:sum("deductibleEur"),excessEur:sum("excessEur"),netEur:sum("netEur"),count:items.length},
    warnings:[...warnings]
  };
}
// Savings base tax (base del ahorro) for the year. Losses from sales offset up to 25% of
// dividends and vice versa (art. 49 LIRPF); prior-year balances are not known here.
const SAVINGS_BRACKETS=[[6000,.19],[50000,.21],[200000,.23],[300000,.27],[Infinity,.30]];
export function savingsTaxEstimate(netGainsEur,dividendsGrossEur){
  let gains=Number(netGainsEur)||0,income=Number(dividendsGrossEur)||0;
  if(gains<0&&income>0){const off=Math.min(-gains,income*.25);income-=off;gains+=off}
  else if(income<0&&gains>0){const off=Math.min(-income,gains*.25);gains-=off;income+=off}
  const base=Math.max(0,gains)+Math.max(0,income);
  let tax=0,prev=0;
  for(const [top,rate] of SAVINGS_BRACKETS){if(base<=prev)break;tax+=(Math.min(base,top)-prev)*rate;prev=top}
  return{baseEur:base,taxEur:tax,lossCarryEur:Math.min(0,gains)};
}

/* ---------------- Rentabilidad de la cartera ----------------
 * Curva diaria en EUR reconstruida con tus operaciones y los cierres diarios (Trade
 * Republic / LSX en EUR; Nasdaq en USD si el valor no tiene ISIN negociable). La
 * rentabilidad es ponderada por tiempo (TWR): las compras y ventas no la alteran, así
 * que se puede comparar con un índice. Índices: ETF iShares Core MSCI World y S&P 500
 * de acumulación en EUR (rentabilidad total). El efecto divisa es la diferencia entre
 * la curva en EUR y la misma curva con el tipo EUR/USD fijo.
 */
export const PERF_BENCHMARKS=[
  {key:"msci",isin:"IE00B4L5Y983",label:"MSCI World"},
  {key:"sp500",isin:"IE00B5BMR087",label:"S&P 500"}
];
async function ensurePriceDailySchema(env){return onCacheDb(env,ensurePriceDailySchemaOn)}
async function ensurePriceDailySchemaOn(env){
  const schemaKey="price:"+cacheDbLabel(env.DB);
  if(cacheSchemaReady.has(schemaKey))return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS price_daily (key TEXT NOT NULL,date TEXT NOT NULL,close REAL NOT NULL CHECK(close>0),PRIMARY KEY(key,date))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS price_daily_meta (key TEXT PRIMARY KEY,currency TEXT NOT NULL,source TEXT NOT NULL,first_day TEXT NOT NULL DEFAULT '',fetched_at INTEGER NOT NULL)")
  ]);
  cacheSchemaReady.add(schemaKey);
}
const PRICE_DAILY_TTL_MS=60*60000;
function perfRangeFor(fromDay){
  const days=(Date.now()-Date.parse(fromDay))/864e5;
  return days<=355?"1y":days<=1810?"5y":"max";
}
// Daily closes for one instrument, cached in D1. Returns {currency,source,rows:[{date,close}]}.
async function loadPriceDaily(env,services,inst,fromDay){
  const key=inst.key;
  const meta=await env.DB.prepare("SELECT currency,source,first_day,fetched_at FROM price_daily_meta WHERE key=?").bind(key).first();
  const fresh=meta&&Date.now()-Number(meta.fetched_at||0)<PRICE_DAILY_TTL_MS&&(!meta.first_day||meta.first_day<=fromDay||meta.source==="none");
  if(!fresh&&services.loadDailyHistory){
    let got=null;
    try{got=await services.loadDailyHistory(inst,perfRangeFor(fromDay),fromDay)}
    catch(error){console.warn("Daily history unavailable",key,String(error&&error.message||error))}
    const rows=(got&&Array.isArray(got.rows)?got.rows:[]).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.close>0);
    if(rows.length){
      await writeChangedDailyRows(env,"price_daily","key",key,"close",rows.map(r=>({date:r.date,value:r.close})));
      await env.DB.prepare("INSERT OR REPLACE INTO price_daily_meta (key,currency,source,first_day,fetched_at) VALUES (?,?,?,?,?)")
        .bind(key,String(got.currency||"EUR").toUpperCase(),String(got.source||""),rows[0].date,Date.now()).run();
    }else if(!meta){
      // Remember the miss for an hour so a broken symbol does not refetch on every open.
      await env.DB.prepare("INSERT OR REPLACE INTO price_daily_meta (key,currency,source,first_day,fetched_at) VALUES (?,?,?,?,?)")
        .bind(key,"EUR","none","",Date.now()).run();
    }
  }
  const m=await env.DB.prepare("SELECT currency,source FROM price_daily_meta WHERE key=?").bind(key).first();
  const res=await env.DB.prepare("SELECT date,close FROM price_daily WHERE key=? AND date>=? ORDER BY date").bind(key,isoDay(Date.parse(fromDay)-10*864e5)).all();
  return{currency:String(m&&m.currency||"EUR").toUpperCase(),source:String(m&&m.source||""),rows:res.results||[]};
}
// Varios valores a la vez: lee de D1 en bloque y solo descarga de la red, como mucho, `budget`
// históricos caducados o que faltan (los que nunca se han descargado van primero). Devuelve
// cuántos siguen sin histórico para que la app vuelva a pedir la curva hasta completarla.
const PERF_FETCH_BUDGET=20;
async function loadPriceDailyBatch(env,...args){return onCacheDb(env,e=>loadPriceDailyBatchOn(e,...args))}
async function loadPriceDailyBatchOn(env,services,list,fromDay,budget=PERF_FETCH_BUDGET){
  await ensurePriceDailySchemaOn(env);
  const keys=list.map(i=>i.key),metas=new Map();
  for(let i=0;i<keys.length;i+=80){
    const part=keys.slice(i,i+80);
    const res=await env.DB.prepare("SELECT key,currency,source,first_day,fetched_at FROM price_daily_meta WHERE key IN ("+part.map(()=>"?").join(",")+")").bind(...part).all();
    for(const r of res.results||[])metas.set(r.key,r);
  }
  const isFresh=m=>m&&Date.now()-Number(m.fetched_at||0)<PRICE_DAILY_TTL_MS&&(!m.first_day||m.first_day<=fromDay||m.source==="none");
  const stale=list.filter(i=>!isFresh(metas.get(i.key)));
  stale.sort((a,b)=>(metas.has(a.key)?1:0)-(metas.has(b.key)?1:0)||(b.benchmark?1:0)-(a.benchmark?1:0));
  const toFetch=services.loadDailyHistory?stale.slice(0,Math.max(0,budget)):[];
  for(let i=0;i<toFetch.length;i+=4){
    await Promise.all(toFetch.slice(i,i+4).map(inst=>loadPriceDaily(env,services,inst,fromDay).catch(()=>null)));
  }
  const fetched=new Set(toFetch.map(i=>i.key));
  // Sin histórico todavía: nunca descargados y no descargados en esta ronda.
  const pending=list.filter(i=>!metas.has(i.key)&&!fetched.has(i.key)).length;
  const prices=new Map(),since=isoDay(Date.parse(fromDay)-10*864e5);
  for(let i=0;i<keys.length;i+=40){
    const part=keys.slice(i,i+40);
    const meta=await env.DB.prepare("SELECT key,currency,source FROM price_daily_meta WHERE key IN ("+part.map(()=>"?").join(",")+")").bind(...part).all();
    const rows=await env.DB.prepare("SELECT key,date,close FROM price_daily WHERE key IN ("+part.map(()=>"?").join(",")+") AND date>=? ORDER BY key,date").bind(...part,since).all();
    const cur=new Map((meta.results||[]).map(r=>[r.key,r]));
    for(const k of part)prices.set(k,{currency:String(cur.get(k)&&cur.get(k).currency||"EUR").toUpperCase(),source:String(cur.get(k)&&cur.get(k).source||""),rows:[]});
    for(const r of rows.results||[]){const p=prices.get(r.key);if(p)p.rows.push({date:r.date,close:r.close})}
  }
  return{prices,pending,total:list.length};
}
function perfInstrumentKey(row){
  const isin=String(row.isin||"").trim().toUpperCase();
  if(/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))return"ISIN:"+isin;
  const ticker=String(row.ticker||"").trim().toUpperCase();
  return ticker?"US:"+ticker:"";
}
function closeLookup(rows){
  return day=>{
    let lo=0,hi=rows.length-1,hit=null;
    while(lo<=hi){const mid=(lo+hi)>>1;if(rows[mid].date<=day){hit=rows[mid];lo=mid+1}else hi=mid-1}
    return hit?hit.close:null;
  };
}

/* Pure computation (exported for tests).
 *   transactions: rows of the transactions table (BUY/SELL/position-adjustment)
 *   prices: Map key -> {currency, rows:[{date,close}]}
 *   fx(currency, day) -> units of currency per 1 EUR (ECB), or null
 *   calendar: sorted trading days (YYYY-MM-DD)
 *   benchmarks: {key: [{date,close}]}
 */
export function computePortfolioPerformance({transactions=[],prices=new Map(),fx=()=>null,calendar=[],benchmarks={},live=new Map()}={}){
  const toEur=(amount,currency,day)=>{
    currency=String(currency||"EUR").toUpperCase();
    if(currency==="EUR")return amount;
    const rate=fx(currency,day);
    return rate>0?amount/rate:null;
  };
  const txs=transactions.slice().filter(t=>finiteNumber(t.quantity)>0&&finiteNumber(t.price)!==null)
    .sort((a,b)=>String(a.executed_at).localeCompare(String(b.executed_at)));
  if(!txs.length||!calendar.length)return null;
  const firstDay=isoDay(txs[0].executed_at);
  const days=calendar.filter(d=>d>=firstDay);
  if(!days.length)return null;
  const instruments=new Map();
  for(const t of txs){
    const key=perfInstrumentKey(t);if(!key)continue;
    const holdKey=String(t.position_id||"")||key+"|"+String(t.portfolio_id||"");
    if(!instruments.has(key)){
      const p=prices.get(key);
      instruments.set(key,{key,ticker:String(t.ticker||""),foreign:String(t.currency||"").toUpperCase()==="USD"||/^US/.test(String(t.isin||"").toUpperCase()),
        price:p&&p.rows&&p.rows.length?closeLookup(p.rows):null,priceCurrency:p&&p.currency||"EUR",firstPriceDay:p&&p.rows&&p.rows.length?p.rows[0].date:null,
        lastTrade:null,holds:new Set()});
    }
    instruments.get(key).holds.add(holdKey);
    t.__key=key;t.__hold=holdKey;t.__day=isoDay(t.executed_at);
  }
  const qty=new Map();
  const fx0=fx("USD",days[0])||null;
  const out={days:[],value:[],flow:[],twr:[],twrLocal:[],invested:[]};
  let idx=1,idxLocal=1,prevV=0,prevVLocal=0,ti=0,invested=0;
  const missing=new Set(),approx=new Set();
  for(const day of days){
    let flow=0,flowLocal=0;
    while(ti<txs.length&&txs[ti].__day<=day){
      const t=txs[ti++];if(!t.__key)continue;
      const inst=instruments.get(t.__key),q=finiteNumber(t.quantity),p=finiteNumber(t.price),fees=Math.max(0,finiteNumber(t.fees)||0);
      const before=qty.get(t.__hold)||0;
      let delta=0,cash=0;
      if(t.origin==="position-adjustment"){delta=q-before;cash=delta*p+fees}
      else if(String(t.side).toUpperCase()==="SELL"){delta=-Math.min(q,before);cash=delta*p+fees}
      else{delta=q;cash=q*p+fees}
      qty.set(t.__hold,before+delta);
      const cashEur=toEur(cash,t.currency,t.__day);
      const unitEur=toEur(p,t.currency,t.__day);
      if(unitEur!==null)inst.lastTrade=unitEur;
      if(cashEur!==null){
        flow+=cashEur;invested+=cashEur;
        const r=inst.foreign&&fx0?(fx("USD",day)||fx0)/fx0:1;
        flowLocal+=cashEur*r;
      }
    }
    let V=0,VLocal=0;
    const usd=fx("USD",day);
    for(const inst of instruments.values()){
      let q=0;for(const h of inst.holds)q+=qty.get(h)||0;
      if(q<=1e-9)continue;
      let pe=null;
      const lv=live.get(inst.key);
      if(lv&&lv.day===day&&lv.priceEur>0)pe=lv.priceEur;
      if(pe===null&&inst.price&&(!inst.firstPriceDay||inst.firstPriceDay<=day)){
        const c=inst.price(day);
        if(c!==null)pe=inst.priceCurrency==="EUR"?c:toEur(c,inst.priceCurrency,day);
      }
      if(pe===null){pe=inst.lastTrade;if(inst.price)approx.add(inst.ticker);else missing.add(inst.ticker)}
      if(pe===null)continue;
      const val=q*pe;V+=val;
      VLocal+=inst.foreign&&fx0&&usd?val*usd/fx0:val;
    }
    const denom=prevV+Math.max(flow,0),denomL=prevVLocal+Math.max(flowLocal,0);
    let r=denom>1e-6?(V-prevV-flow)/denom:0,rl=denomL>1e-6?(VLocal-prevVLocal-flowLocal)/denomL:0;
    if(!Number.isFinite(r))r=0;if(!Number.isFinite(rl))rl=0;
    r=Math.max(-0.9,Math.min(3,r));rl=Math.max(-0.9,Math.min(3,rl));
    idx*=1+r;idxLocal*=1+rl;
    out.days.push(day);out.value.push(Math.round(V*100)/100);out.flow.push(Math.round(flow*100)/100);
    out.invested.push(Math.round(invested*100)/100);
    out.twr.push(Math.round(idx*1e6)/1e6);out.twrLocal.push(Math.round(idxLocal*1e6)/1e6);
    prevV=V;prevVLocal=VLocal;
  }
  const bench={};
  for(const [k,rows] of Object.entries(benchmarks)){
    if(!rows||!rows.length)continue;
    const look=closeLookup(rows);
    const series=out.days.map(d=>look(d));
    const base=series.find(x=>x>0);
    if(base)bench[k]=series.map(x=>x>0?Math.round(x/base*1e6)/1e6:null);
  }
  out.benchmarks=bench;
  out.missing=[...missing].filter(Boolean).slice(0,20);
  out.approx=[...approx].filter(t=>t&&!missing.has(t)).slice(0,20);
  out.instruments=instruments.size;
  return out;
}

const perfMemo=new Map();
async function handlePortfolioPerformance(request,env,user,json,url,services){
  if(request.method!=="GET")return json({error:"Method not allowed"},405);
  await ensureTransactionsSchema(env);
  await ensurePriceDailySchema(env);
  const pid=trimText(url.searchParams.get("portfolioId"),80)||"all";
  if(pid!=="all"&&!(await onePortfolio(env,user.id,pid)))return json({error:"Portfolio not found"},404);
  // The memo is keyed by the ledger state, so a new or edited operation recomputes at once.
  const sig=pid==="all"
    ? await env.DB.prepare("SELECT COUNT(*) AS n,MAX(updated_at) AS u FROM transactions WHERE user_id=?").bind(user.id).first()
    : await env.DB.prepare("SELECT COUNT(*) AS n,MAX(updated_at) AS u FROM transactions WHERE user_id=? AND portfolio_id=?").bind(user.id,pid).first();
  const memoKey=user.id+"|"+pid,memoSig=String(sig&&sig.n||0)+"|"+String(sig&&sig.u||""),hit=perfMemo.get(memoKey);
  if(hit&&hit.sig===memoSig&&Date.now()-hit.at<5*60000&&url.searchParams.get("fresh")!=="1")return json(hit.payload);
  const res=pid==="all"
    ? await env.DB.prepare("SELECT position_id,portfolio_id,stock_key,ticker,isin,side,quantity,price,fees,currency,executed_at,origin FROM transactions WHERE user_id=? ORDER BY executed_at ASC,created_at ASC").bind(user.id).all()
    : await env.DB.prepare("SELECT position_id,portfolio_id,stock_key,ticker,isin,side,quantity,price,fees,currency,executed_at,origin FROM transactions WHERE user_id=? AND portfolio_id=? ORDER BY executed_at ASC,created_at ASC").bind(user.id,pid).all();
  const txs=res.results||[];
  if(!txs.length){const payload={portfolioId:pid,empty:true,generatedAt:nowIso()};return json(payload)}
  const firstDay=isoDay(txs[0].executed_at)||isoDay(Date.now());
  const today=isoDay(Date.now());
  const fromDay=isoDay(Date.parse(firstDay)-7*864e5);
  // Instruments (unique by ISIN / ticker) plus the two benchmark ETFs.
  const insts=new Map();
  for(const t of txs){const key=perfInstrumentKey(t);if(key&&!insts.has(key))insts.set(key,{key,isin:key.startsWith("ISIN:")?key.slice(5):"",ticker:String(t.ticker||"").toUpperCase(),stockKey:String(t.stock_key||"")})}
  for(const b of PERF_BENCHMARKS)insts.set("ISIN:"+b.isin,{key:"ISIN:"+b.isin,isin:b.isin,ticker:b.label,benchmark:b.key});
  const list=[...insts.values()];
  const loaded=await loadPriceDailyBatch(env,services,list,fromDay);
  const prices=loaded.prices;
  // Faltan históricos: se devuelve el avance y la app vuelve a pedir la curva en unos segundos.
  if(loaded.pending>0)return json({portfolioId:pid,computing:true,done:loaded.total-loaded.pending,total:loaded.total,generatedAt:nowIso()});
  // ECB EUR/USD (and any other trade currency).
  const currencies=new Set(["USD"]);
  for(const t of txs){const c=String(t.currency||"EUR").toUpperCase();if(c!=="EUR"&&/^[A-Z]{3}$/.test(c))currencies.add(c)}
  for(const p of prices.values())if(p.currency!=="EUR")currencies.add(p.currency);
  const lookups={};
  for(const c of currencies){try{lookups[c]=fxLookup(await loadEcbRates(env,c,isoDay(Date.parse(fromDay)-12*864e5),today))}catch(_){lookups[c]=()=>null}}
  const fx=(c,d)=>{const hit=lookups[c]&&lookups[c](d);return hit?hit.rate:null};
  // Trading calendar: LSX days from the MSCI World ETF, plus every day with a price, plus today on weekdays.
  const daySet=new Set();
  for(const [key,p] of prices)for(const r of p.rows)if(r.date>=firstDay&&(key==="ISIN:"+PERF_BENCHMARKS[0].isin||!insts.get(key).benchmark))daySet.add(r.date);
  const wd=new Date(today+"T12:00:00Z").getUTCDay();
  if(wd!==0&&wd!==6)daySet.add(today);
  const calendar=[...daySet].filter(d=>{const w=new Date(d+"T12:00:00Z").getUTCDay();return w!==0&&w!==6&&d<=today}).sort();
  // Live overlay for today's point on instruments priced from Nasdaq (no intraday bar).
  const live=new Map();
  if(services.loadMarketSnapshot){
    try{
      const snapshot=await services.loadMarketSnapshot(env);
      const eurUsd=finiteNumber(snapshot&&snapshot.meta&&snapshot.meta.eurUsd);
      for(const inst of insts.values()){
        if(inst.benchmark)continue;
        const p=prices.get(inst.key);
        const lastRow=p&&p.rows.length?p.rows[p.rows.length-1].date:"";
        if(p&&p.currency==="EUR"&&lastRow===today)continue;
        const stock=findStock(snapshot,{stock_key:inst.stockKey,ticker:inst.ticker});
        const usd=finiteNumber(stock&&(stock.usLivePrice??stock.price));
        if(usd>0&&eurUsd>0)live.set(inst.key,{day:today,priceEur:usd/eurUsd});
      }
    }catch(_){}
  }
  const benchmarks={};
  for(const b of PERF_BENCHMARKS)benchmarks[b.key]=(prices.get("ISIN:"+b.isin)||{rows:[]}).rows;
  const result=computePortfolioPerformance({transactions:txs,prices,fx,calendar,benchmarks,live});
  const payload=result
    ? Object.assign({portfolioId:pid,currency:"EUR",benchmarkLabels:Object.fromEntries(PERF_BENCHMARKS.map(b=>[b.key,b.label])),generatedAt:nowIso()},result)
    : {portfolioId:pid,empty:true,generatedAt:nowIso()};
  perfMemo.set(memoKey,{at:Date.now(),sig:memoSig,payload});
  if(perfMemo.size>500)perfMemo.delete(perfMemo.keys().next().value);
  return json(payload);
}

/* ---------------- Radar AI · marcador de aciertos ----------------
 * Cada día de mercado, a las 15:45 de Nueva York (12:45 en cierre anticipado), se
 * guarda la foto del Radar AI calculada con el mismo motor que la pantalla y con los
 * precios en vivo. 1, 5 y 20 sesiones después se anota la rentabilidad de cada señal
 * y la del S&P 500 (SPY) en el mismo intervalo. Nada se reescribe: es un registro.
 */
const RADAR_HORIZONS=[1,5,20];
async function ensureRadarScoreboardSchema(env){
  const schemaKey="radar:"+cacheDbLabel(env.DB);
  if(cacheSchemaReady.has(schemaKey)&&!(schemaKey==="radar:turso"&&cacheDbState.radarSyncPending))return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS radar_signals (id TEXT PRIMARY KEY,day TEXT NOT NULL,stock_key TEXT NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',tier TEXT NOT NULL,score REAL NOT NULL,quality REAL NOT NULL,price REAL NOT NULL CHECK(price>0),bench_price REAL,tr_tradable INTEGER NOT NULL DEFAULT 0,speculative INTEGER NOT NULL DEFAULT 0,ret_1d REAL,ret_5d REAL,ret_20d REAL,bench_1d REAL,bench_5d REAL,bench_20d REAL,created_at TEXT NOT NULL,UNIQUE(day,stock_key))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_radar_signals_day ON radar_signals(day)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS radar_bench (day TEXT PRIMARY KEY,price REAL NOT NULL CHECK(price>0),created_at TEXT NOT NULL)")
  ]);
  // Solo se da por listo cuando la sincronización con D1 termina bien (si falla, se reintenta).
  if(schemaKey==="radar:turso"){await migrateRadarToCache(env);cacheDbState.radarSyncPending=false}
  cacheSchemaReady.add(schemaKey);
}
// Sincroniza el marcador de D1 hacia Turso: la primera vez copia todo el historial y después
// (al arrancar cada isolate y tras cualquier caída de Turso) los últimos 45 días, para recoger
// las señales y resultados que se guardaron en D1 mientras Turso no respondía. Los ids son
// aleatorios, así que se concilia por (day, stock_key): INSERT OR IGNORE para lo nuevo y un
// UPDATE que solo rellena resultados vacíos en Turso (no escribe si ya están).
async function migrateRadarToCache(env){
  if(cacheDbLabel(env.DB)!=="turso"||!env.D1_PRIMARY)return;
  const d1=env.D1_PRIMARY;
  const exists=await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='radar_signals'").first();
  if(!exists)return;
  const has=await env.DB.prepare("SELECT COUNT(*) AS n FROM radar_signals").first();
  const since=Number(has&&has.n)>0?isoDay(Date.now()-45*864e5):"";
  const cols="id,day,stock_key,ticker,name,tier,score,quality,price,bench_price,tr_tradable,speculative,ret_1d,ret_5d,ret_20d,bench_1d,bench_5d,bench_20d,created_at";
  const names=cols.split(","),marks=names.map(()=>"?").join(",");
  const rows=(await d1.prepare("SELECT "+cols+" FROM radar_signals WHERE day>=? ORDER BY day").bind(since).all()).results||[];
  for(let i=0;i<rows.length;i+=60)await env.DB.batch(rows.slice(i,i+60).map(r=>env.DB.prepare("INSERT OR IGNORE INTO radar_signals ("+cols+") VALUES ("+marks+")").bind(...names.map(n=>r[n]??null))));
  const done=rows.filter(r=>r.ret_1d!==null&&r.ret_1d!==undefined||r.ret_5d!==null&&r.ret_5d!==undefined||r.ret_20d!==null&&r.ret_20d!==undefined);
  const v=x=>x===undefined?null:x;
  for(let i=0;i<done.length;i+=60)await env.DB.batch(done.slice(i,i+60).map(r=>env.DB.prepare(
    "UPDATE radar_signals SET ret_1d=COALESCE(ret_1d,?),bench_1d=COALESCE(bench_1d,?),ret_5d=COALESCE(ret_5d,?),bench_5d=COALESCE(bench_5d,?),ret_20d=COALESCE(ret_20d,?),bench_20d=COALESCE(bench_20d,?) "+
    "WHERE day=? AND stock_key=? AND ((ret_1d IS NULL AND ? IS NOT NULL) OR (ret_5d IS NULL AND ? IS NOT NULL) OR (ret_20d IS NULL AND ? IS NOT NULL))"
  ).bind(v(r.ret_1d),v(r.bench_1d),v(r.ret_5d),v(r.bench_5d),v(r.ret_20d),v(r.bench_20d),r.day,r.stock_key,v(r.ret_1d),v(r.ret_5d),v(r.ret_20d))));
  const bench=(await d1.prepare("SELECT day,price,created_at FROM radar_bench WHERE day>=?").bind(since).all()).results||[];
  for(let i=0;i<bench.length;i+=60)await env.DB.batch(bench.slice(i,i+60).map(r=>env.DB.prepare("INSERT OR IGNORE INTO radar_bench (day,price,created_at) VALUES (?,?,?)").bind(r.day,r.price,r.created_at)));
}
function radarMarkWindow(nowMs){
  const api=globalThis.ViewInvAIMarketSession;
  if(!api)return null;
  const parts=api.zoneClock("America/New_York",new Date(nowMs));
  const cal=api.usMarketCalendar(parts);
  if(!cal.open)return null;
  const minutes=(+parts.hour%24)*60+(+parts.minute);
  const mark=(cal.earlyClose?780:960)-15;
  if(minutes<mark||minutes>=mark+10)return null;
  return{day:api.dateKey(+parts.year,+parts.month,+parts.day)};
}
async function fetchBenchmarkPrice(){
  const r=await fetch("https://scanner.tradingview.com/america/scan",{method:"POST",headers:{"Content-Type":"application/json","User-Agent":"Mozilla/5.0","Origin":"https://www.tradingview.com"},body:JSON.stringify({symbols:{tickers:["AMEX:SPY"],query:{types:[]}},columns:["close"]})});
  if(!r.ok)throw new Error("SPY "+r.status);
  const data=await r.json();
  const price=Number(data&&data.data&&data.data[0]&&data.data[0].d&&data.data[0].d[0]);
  if(!(price>0))throw new Error("SPY sin precio");
  return price;
}
export function radarSignalsForSnapshot(snapshot,nowMs=Date.now()){
  const engine=globalThis.ViewInvAIScore;
  if(!engine||!snapshot||!Array.isArray(snapshot.stocks))return[];
  const byTicker=new Map();
  for(const e of Array.isArray(snapshot.events)?snapshot.events:[]){
    const t=String(e&&e.ticker||"").toUpperCase();if(!t)continue;
    if(!byTicker.has(t))byTicker.set(t,[]);byTicker.get(t).push(e);
  }
  const snapshotAt=Date.parse(snapshot.meta&&(snapshot.meta.liveUpdatedAt||snapshot.meta.updatedAt))||null;
  const rows=[];
  for(const s of snapshot.stocks){
    const price=finiteNumber(s.price);if(!(price>0))continue;
    const events=byTicker.get(String(s.ticker||"").toUpperCase())||[];
    const input={price,change:finiteNumber(s.changePct),volume:finiteNumber(s.volume),avgVolume:finiteNumber(s.avgVolume),relVolume:finiteNumber(s.relVolume),
      rsi:finiteNumber(s.rsi),adx:finiteNumber(s.adx),ema20:finiteNumber(s.ema20),ema50:finiteNumber(s.ema50),perfWeek:finiteNumber(s.perfWeek),perfMonth:finiteNumber(s.perfMonth),
      spread:null,bid:null,ask:null,quoteAgeMs:null,snapshotAgeMs:snapshotAt?Math.max(0,nowMs-snapshotAt):null,chartAvailable:false};
    const a=engine.analyze(input,events,nowMs);
    const score=finiteNumber(a.score)??0,quality=finiteNumber(a.quality&&a.quality.score)??0;
    // Same rule as the Radar AI screen (alta convicción needs AI validation, not logged here).
    const intl=String(s.region||"")==="intl";
    const rt=typeof engine.radarTier==="function"
      ?engine.radarTier({score,quality,price,marketCap:finiteNumber(s.marketCap),avgVolume:finiteNumber(s.avgVolume),events,nowMs,market:intl?"tr":"us"})
      :{tier:"",eligible:false};
    if(!rt.tier)continue;
    rows.push({stock_key:String(s.tvSymbol||((s.exchange||"")+":"+(s.ticker||""))).toUpperCase(),ticker:String(s.ticker||""),name:String(s.name||""),
      tier:rt.tier==="spec"?"opportunity":rt.tier,score,quality,price,tr_tradable:s.tradeRepublicTradable===true?1:0,speculative:rt.tier==="spec"?1:0});
  }
  rows.sort((a,b)=>b.score-a.score||b.quality-a.quality);
  // The screen shows at most 12 opportunities, 15 on watch and 10 speculative per market.
  const opp=rows.filter(r=>r.tier==="opportunity"&&!r.speculative).slice(0,24),watch=rows.filter(r=>r.tier==="watch").slice(0,30),spec=rows.filter(r=>r.speculative).slice(0,20);
  return[...opp,...watch,...spec];
}
export async function runRadarScoreboard(env,...args){return onCacheDb(env,e=>runRadarScoreboardOn(e,...args))}
async function runRadarScoreboardOn(env,services={},nowMs=Date.now()){
  if(!env.DB||!services.loadMarketSnapshot)return{skipped:"no-db"};
  const win=radarMarkWindow(nowMs);
  if(!win)return{skipped:"outside-window"};
  await ensureRadarScoreboardSchema(env);
  const done=await env.DB.prepare("SELECT day FROM radar_bench WHERE day=?").bind(win.day).first();
  if(done)return{skipped:"already-marked"};
  const snapshot=await services.loadMarketSnapshot(env);
  const benchPrice=await (services.loadBenchmark?services.loadBenchmark():fetchBenchmarkPrice());
  const now=nowIso();
  // 1) Evaluate earlier signals with today's live prices.
  const priceByKey=new Map(snapshot.stocks.map(s=>[String(s.tvSymbol||((s.exchange||"")+":"+(s.ticker||""))).toUpperCase(),finiteNumber(s.price)]));
  const benchDays=((await env.DB.prepare("SELECT day FROM radar_bench ORDER BY day ASC").all()).results||[]).map(r=>r.day);
  const pending=(await env.DB.prepare("SELECT id,day,stock_key,price,bench_price,ret_1d,ret_5d,ret_20d FROM radar_signals WHERE ret_20d IS NULL AND day<?").bind(win.day).all()).results||[];
  const updates=[];
  for(const sig of pending){
    const sessions=benchDays.filter(d=>d>sig.day).length+1; // today is one more session after the signal
    const now_px=priceByKey.get(String(sig.stock_key).toUpperCase());
    if(!(now_px>0)||!(sig.price>0))continue;
    const ret=(now_px/sig.price-1)*100,bench=sig.bench_price>0?(benchPrice/sig.bench_price-1)*100:null;
    for(const h of RADAR_HORIZONS){
      if(sessions>=h&&sig["ret_"+h+"d"]===null){
        updates.push(env.DB.prepare("UPDATE radar_signals SET ret_"+h+"d=?,bench_"+h+"d=? WHERE id=? AND ret_"+h+"d IS NULL").bind(Math.round(ret*1000)/1000,bench===null?null:Math.round(bench*1000)/1000,sig.id));
      }
    }
  }
  for(let i=0;i<updates.length;i+=80)await env.DB.batch(updates.slice(i,i+80));
  // 2) Record today's signals and the benchmark mark.
  const signals=radarSignalsForSnapshot(snapshot,nowMs);
  const inserts=signals.map(r=>env.DB.prepare(
    "INSERT OR IGNORE INTO radar_signals (id,day,stock_key,ticker,name,tier,score,quality,price,bench_price,tr_tradable,speculative,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(uid("rs_"),win.day,r.stock_key,r.ticker,r.name.slice(0,160),r.tier,r.score,r.quality,r.price,benchPrice,r.tr_tradable,r.speculative,now));
  for(let i=0;i<inserts.length;i+=80)await env.DB.batch(inserts.slice(i,i+80));
  await env.DB.prepare("INSERT OR IGNORE INTO radar_bench (day,price,created_at) VALUES (?,?,?)").bind(win.day,benchPrice,now).run();
  return{day:win.day,signals:signals.length,evaluated:updates.length};
}
function radarStats(rows,h){
  const done=rows.filter(r=>r["ret_"+h+"d"]!==null&&r["ret_"+h+"d"]!==undefined);
  if(!done.length)return{n:0};
  const rets=done.map(r=>Number(r["ret_"+h+"d"])).sort((a,b)=>a-b);
  const excess=done.filter(r=>r["bench_"+h+"d"]!==null).map(r=>Number(r["ret_"+h+"d"])-Number(r["bench_"+h+"d"]));
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const beat=excess.filter(x=>x>0).length;
  return{n:done.length,hitRate:Math.round(rets.filter(x=>x>0).length/rets.length*1000)/10,avgReturn:Math.round(avg(rets)*100)/100,
    median:Math.round(rets[Math.floor(rets.length/2)]*100)/100,avgExcess:excess.length?Math.round(avg(excess)*100)/100:null,
    beatRate:excess.length?Math.round(beat/excess.length*1000)/10:null,best:Math.round(rets[rets.length-1]*10)/10,worst:Math.round(rets[0]*10)/10};
}
export async function radarScoreboardSummary(env){return onCacheDb(env,radarScoreboardSummaryOn)}
async function radarScoreboardSummaryOn(env){
  await ensureRadarScoreboardSchema(env);
  const rows=(await env.DB.prepare("SELECT day,ticker,name,stock_key,tier,score,price,tr_tradable,speculative,ret_1d,ret_5d,ret_20d,bench_1d,bench_5d,bench_20d FROM radar_signals WHERE day>=? ORDER BY day DESC,score DESC").bind(new Date(Date.now()-400*864e5).toISOString().slice(0,10)).all()).results||[];
  const firstDay=rows.length?rows[rows.length-1].day:null;
  const groups={
    opportunity:rows.filter(r=>r.tier==="opportunity"),
    opportunitySolid:rows.filter(r=>r.tier==="opportunity"&&Number(r.speculative)===0),
    watch:rows.filter(r=>r.tier==="watch"),
    trTradable:rows.filter(r=>Number(r.tr_tradable)===1&&r.tier==="opportunity")
  };
  const stats={};
  for(const [k,list] of Object.entries(groups))stats[k]=Object.fromEntries(RADAR_HORIZONS.map(h=>[h+"d",radarStats(list,h)]));
  const days=[...new Set(rows.map(r=>r.day))];
  return{since:firstDay,days:days.length,signals:rows.length,stats,
    recent:rows.filter(r=>r.tier==="opportunity").slice(0,25).map(r=>({day:r.day,ticker:r.ticker,name:r.name,stockKey:r.stock_key,score:r.score,speculative:Number(r.speculative)===1,trTradable:Number(r.tr_tradable)===1,ret1d:r.ret_1d,ret5d:r.ret_5d,ret20d:r.ret_20d,bench5d:r.bench_5d})),
    method:"Foto diaria a las 15:45 de Nueva York con el motor del Radar AI y precios en vivo; rentabilidad desde ese precio 1, 5 y 20 sesiones después, frente al SPY en el mismo intervalo. Sin comisiones ni deslizamiento.",
    updatedAt:nowIso()};
}

function txResult(body,status=200){return{status,body}}

// Shared by the manual form and broker imports. options.origin tags the row
// ('manual', 'import:tr', 'import:ibkr', 'import:csv'); options.externalId is the
// broker's execution id, unique per user, so a repeated import is a no-op.
async function createTransactionRecord(env, user, data, options = {}) {
  const origin = trimText(options.origin || "manual", 40) || "manual";
  const externalId = trimText(options.externalId, 120);
  const adjustCash = options.adjustCash !== false;
    if (!data.portfolioId || !data.stockKey || !data.ticker) return txResult({ error: "portfolioId, stockKey and ticker are required" }, 400);
    if (!["BUY","SELL"].includes(data.side)) return txResult({ error: "side must be BUY or SELL" }, 400);
    if (data.quantity === null || data.quantity <= 0) return txResult({ error: "quantity must be greater than zero" }, 400);
    if (data.price === null || data.price < 0) return txResult({ error: "price must be zero or greater" }, 400);
    if(data.fees===null){
      const autoFee=await brokerFeeForTrade(env,user.id,data.broker,data.quantity,data.price,data.currency,data.side,data.exchange);
      if(autoFee.fee===null&&options.defaultFees!==undefined){autoFee.fee=options.defaultFees}
      if(autoFee.fee===null)return txResult({error:autoFee.reason==="currency-mismatch"?"La comisión de este broker se cobra en otra divisa: indícala manualmente en la divisa de la operación.":"No se ha podido verificar todavía la comisión de este broker."},409);
      data.fees=autoFee.fee;
    }
    if (data.fees < 0) return txResult({ error: "fees cannot be negative" }, 400);
    if (!data.executedAt) return txResult({ error: "executedAt is invalid" }, 400);
    if (!(await onePortfolio(env, user.id, data.portfolioId))) return txResult({ error: "Portfolio not found" }, 404);

    let position=data.positionId
      ?await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(data.positionId,user.id).first()
      :null;
    if(!position){
      const broker=trimText(data.broker,80);
      position=await env.DB.prepare(
        "SELECT * FROM positions WHERE user_id=? AND portfolio_id=? AND stock_key=? AND broker=? AND currency=? AND prefer_tr=? AND exchange=?"
      ).bind(user.id,data.portfolioId,data.stockKey,broker,data.currency,data.preferTr,data.exchange).first();
    }
    if(position){
      await ensureOpeningTransaction(env,user.id,position);
      const positionCurrency=String(position.currency||data.currency).toUpperCase();
      if(positionCurrency!==data.currency)return txResult({error:"Transaction currency must match the position currency"},400);
    }else if(data.side==="SELL"){
      return txResult({error:"Position not found for sell"},404);
    }

    const resolvedPositionId=position&&position.id?position.id:uid("pos_");
    const beforeRows=position
      ?await transactionRows(env,user.id,data.portfolioId,data.stockKey,resolvedPositionId)
      :[];
    const before=calculateTransactionLedger(beforeRows);
    if(data.side==="SELL"&&data.quantity>before.quantity+1e-8){
      return txResult({error:"Sell quantity exceeds current position"},400);
    }

    const txId = uid("tx_");
    const now = nowIso();
    const txBroker=trimText(data.broker||(position&&position.broker),80);
    await env.DB.prepare(
      "INSERT INTO transactions (id,portfolio_id,user_id,position_id,broker,stock_key,ticker,name,exchange,isin,prefer_tr,side,quantity,price,fees,currency,executed_at,notes,origin,external_id,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      txId,data.portfolioId,user.id,resolvedPositionId,txBroker,data.stockKey,data.ticker,data.name,data.exchange,data.isin,data.preferTr,
      data.side,data.quantity,data.price,data.fees,data.currency,data.executedAt,data.notes,origin,externalId,now,now
    ).run();

    const cashAdjustment = adjustCash
      ? await adjustPortfolioCashForTransaction(
        env,user.id,data.portfolioId,data.currency,data.side,data.quantity,data.price,data.fees,1,null,data.cashFxRate
      )
      : { adjusted:false };
    await env.DB.prepare("UPDATE transactions SET cash_delta=?,cash_currency=?,updated_at=? WHERE id=? AND user_id=?")
      .bind(cashAdjustment.adjusted?(finiteNumber(cashAdjustment.delta)||0):0,cashAdjustment.adjusted?String(cashAdjustment.baseCurrency||data.currency):"",nowIso(),txId,user.id).run();
    const recalculated = await recalculatePositionFromTransactions(env,user.id,data.portfolioId,data.stockKey,resolvedPositionId);
    const transaction = await env.DB.prepare("SELECT * FROM transactions WHERE id=? AND user_id=?").bind(txId, user.id).first();
    return txResult({ transaction, position: recalculated && recalculated.position, summary: recalculated && recalculated.ledger, cashAdjustment }, 201);
}

async function handleTransactions(request, env, user, json, parts, url) {
  await ensurePositionBrokerSchema(env);
  await ensureTransactionsSchema(env);
  const id = parts[1] || "";

  if (request.method === "GET" && !id) {
    const portfolioId = trimText(url.searchParams.get("portfolioId"), 80);
    const stockKey = trimText(url.searchParams.get("stockKey"), 80).toUpperCase();
    const positionId = trimText(url.searchParams.get("positionId"), 80);
    const limit = Math.max(1, Math.min(500, Math.round(finiteNumber(url.searchParams.get("limit")) || 200)));

    let rows;
    if(positionId){
      rows=await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND position_id=? ORDER BY executed_at DESC,created_at DESC LIMIT ?"
      ).bind(user.id,positionId,limit).all();
    } else if (portfolioId && stockKey) {
      rows = await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND portfolio_id=? AND stock_key=? ORDER BY executed_at DESC,created_at DESC LIMIT ?"
      ).bind(user.id, portfolioId, stockKey, limit).all();
    } else if (portfolioId) {
      rows = await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND portfolio_id=? ORDER BY executed_at DESC,created_at DESC LIMIT ?"
      ).bind(user.id, portfolioId, limit).all();
    } else {
      rows = await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? ORDER BY executed_at DESC,created_at DESC LIMIT ?"
      ).bind(user.id, limit).all();
    }

    let summary = null, portfolioSummary = null;
    if(positionId){
      const p=await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(positionId,user.id).first();
      if(p){
        const ascending=await transactionRows(env,user.id,p.portfolio_id,p.stock_key,p.id);
        summary=calculateTransactionLedger(ascending);
      }
    } else if (portfolioId && stockKey) {
      const ascending = await transactionRows(env, user.id, portfolioId, stockKey);
      summary = calculateTransactionLedger(ascending);
    } else if (portfolioId) {
      const all = await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND portfolio_id=? ORDER BY executed_at ASC,created_at ASC"
      ).bind(user.id, portfolioId).all();
      portfolioSummary = calculatePortfolioTransactionSummary(all.results || []);
    }
    return json({ transactions: rows.results || [], summary, portfolioSummary });
  }

  if (request.method === "POST" && id === "import") return handleTransactionImport(request, env, user, json);

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const result = await createTransactionRecord(env, user, transactionPayload(body));
    return json(result.body, result.status);
  }

  if (!id) return json({ error: "Transaction id required" }, 400);
  const existing = await env.DB.prepare("SELECT * FROM transactions WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!existing) return json({ error: "Transaction not found" }, 404);

  if (request.method === "DELETE") {
    if (String(existing.origin || "") === "position-seed") {
      return json({ error: "The initial imported transaction cannot be deleted directly" }, 409);
    }
    await env.DB.prepare("DELETE FROM transactions WHERE id=? AND user_id=?").bind(id, user.id).run();
    const cashAdjustment = await adjustPortfolioCashForTransaction(
      env,user.id,existing.portfolio_id,existing.cash_currency||existing.currency,existing.side,existing.quantity,existing.price,existing.fees,-1,finiteNumber(existing.cash_delta)||0
    );
    const recalculated = await recalculatePositionFromTransactions(env,user.id,existing.portfolio_id,existing.stock_key,existing.position_id||"");
    return json({ deleted: true, position: recalculated && recalculated.position, summary: recalculated && recalculated.ledger, cashAdjustment });
  }

  return json({ error: "Method not allowed" }, 405);
}


function normalizedContributionFrequency(value){
  const v=String(value||"monthly").trim().toLowerCase();
  return ["weekly","monthly","quarterly","annual","manual"].includes(v)?v:"monthly";
}
function contributionNextDate(startDate,dayOfMonth,frequency,fromDate=new Date()){
  if(frequency==="manual")return null;
  const start=startDate?new Date(startDate+"T00:00:00Z"):null;
  const from=Number.isFinite(fromDate.getTime())?new Date(fromDate):new Date();
  let cursor=start&&Number.isFinite(start.getTime())&&start>from?start:new Date(from);
  cursor.setUTCHours(9,0,0,0);
  if(frequency==="weekly"){
    if(start&&Number.isFinite(start.getTime())){
      const weekday=start.getUTCDay();
      while(cursor.getUTCDay()!==weekday||cursor<from)cursor.setUTCDate(cursor.getUTCDate()+1);
      return cursor.toISOString();
    }
    cursor.setUTCDate(cursor.getUTCDate()+7);
    return cursor.toISOString();
  }
  const monthStep=frequency==="quarterly"?3:frequency==="annual"?12:1;
  const desired=Math.max(1,Math.min(31,Number(dayOfMonth)||((start&&start.getUTCDate())||1)));
  const candidate=(year,month)=>{
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    return new Date(Date.UTC(year,month,Math.min(desired,last),9,0,0));
  };
  let d=candidate(cursor.getUTCFullYear(),cursor.getUTCMonth());
  if(d<from){
    let month=cursor.getUTCMonth()+monthStep,year=cursor.getUTCFullYear()+Math.floor(month/12);
    month=((month%12)+12)%12;
    d=candidate(year,month);
  }
  if(start&&Number.isFinite(start.getTime())&&d<start){
    let y=start.getUTCFullYear(),m=start.getUTCMonth();
    d=candidate(y,m);
    if(d<start){
      m+=monthStep;y+=Math.floor(m/12);m=((m%12)+12)%12;d=candidate(y,m);
    }
  }
  return d.toISOString();
}

async function handleFundPlans(request, env, user, json, parts, url) {
  await ensureFundSchema(env);
  const id=parts[1]||"";
  if(request.method==="GET"&&!id){
    const portfolioId=trimText(url.searchParams.get("portfolioId"),80);
    const stmt=portfolioId
      ? env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE user_id=? AND fund_portfolio_id=? ORDER BY enabled DESC,day_of_month ASC,created_at ASC").bind(user.id,portfolioId)
      : env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE user_id=? ORDER BY enabled DESC,created_at ASC").bind(user.id);
    const rows=await stmt.all();
    // Saveback y Redondeo (Trade Republic): no son planes de importe fijo (dependen de lo que
    // pagas con la tarjeta), así que se resumen como suma: total aportado a cada fondo,
    // lo de este año, número de compras y participaciones que suman.
    const yearStart=new Date().getUTCFullYear()+"-01-01";
    const benefits=await env.DB.prepare(
      "SELECT t.fund_portfolio_id,t.isin,p.name,t.notes AS kind,COUNT(*) AS n,SUM(t.units*t.price) AS total,SUM(t.units) AS units," +
      " SUM(CASE WHEN t.executed_at>=? THEN t.units*t.price ELSE 0 END) AS year_total,MIN(t.executed_at) AS first_at,MAX(t.executed_at) AS last_at" +
      " FROM fund_transactions t LEFT JOIN fund_positions p ON p.id=t.fund_position_id WHERE t.user_id=? AND t.side='BUY' AND t.notes IN ('Saveback','Redondeo')" +
      (portfolioId?" AND t.fund_portfolio_id=?":"") + " GROUP BY t.fund_portfolio_id,t.isin,t.notes"
    ).bind(...(portfolioId?[yearStart,user.id,portfolioId]:[yearStart,user.id])).all();
    return json({plans:rows.results||[],benefits:benefits.results||[]});
  }
  if(request.method==="POST"&&!id){
    const body=await readJson(request);
    const portfolioId=trimText(body.fundPortfolioId,80);
    if(!portfolioId||!(await oneFundPortfolio(env,user.id,portfolioId)))return json({error:"Fund portfolio not found"},404);
    const amount=finiteNumber(body.amount),day=Math.round(finiteNumber(body.dayOfMonth)||0);
    if(amount!==null&&amount<0)return json({error:"amount cannot be negative"},400);
    if(day<0||day>31)return json({error:"dayOfMonth must be between 1 and 31"},400);
    const frequency=normalizedContributionFrequency(body.frequency),enabled=body.enabled===false?0:1;
    const startDate=trimText(body.startDate,10)||new Date().toISOString().slice(0,10);
    const status=enabled?(String(body.status||"active")==="paused"?"paused":"active"):"paused";
    const next=status==="active"?contributionNextDate(startDate,day,frequency):null;
    const now=nowIso(),idNew=uid("fplan_");
    await env.DB.prepare(
      "INSERT INTO fund_contribution_plans (id,fund_portfolio_id,fund_position_id,user_id,isin,label,kind,amount,currency,day_of_month,frequency,start_date,status,next_contribution_at,enabled,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(idNew,portfolioId,trimText(body.fundPositionId,80)||null,user.id,trimText(body.isin,24).toUpperCase(),trimText(body.label,160),trimText(body.kind,30)||"monthly",amount,String(body.currency||"EUR").toUpperCase(),day||null,frequency,startDate,status,next,enabled,trimText(body.notes,1000),now,now).run();
    return json({plan:await env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE id=? AND user_id=?").bind(idNew,user.id).first()},201);
  }
  if(!id)return json({error:"Fund plan id required"},400);
  const existing=await env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE id=? AND user_id=?").bind(id,user.id).first();
  if(!existing)return json({error:"Fund plan not found"},404);
  if(request.method==="PATCH"){
    const body=await readJson(request);
    const amount=body.amount!==undefined?finiteNumber(body.amount):finiteNumber(existing.amount);
    const day=body.dayOfMonth!==undefined?Math.round(finiteNumber(body.dayOfMonth)||0):Number(existing.day_of_month||0);
    if(amount!==null&&amount<0)return json({error:"amount cannot be negative"},400);
    if(day<0||day>31)return json({error:"dayOfMonth must be between 1 and 31"},400);
    const frequency=body.frequency!==undefined?normalizedContributionFrequency(body.frequency):normalizedContributionFrequency(existing.frequency);
    const enabled=body.enabled!==undefined?(body.enabled?1:0):Number(existing.enabled)!==0?1:0;
    const startDate=body.startDate!==undefined?(trimText(body.startDate,10)||null):(existing.start_date||null);
    const status=enabled?(body.status!==undefined?(String(body.status)==="paused"?"paused":"active"):(String(existing.status||"active")==="paused"?"paused":"active")):"paused";
    const next=status==="active"?contributionNextDate(startDate,day,frequency):null;
    await env.DB.prepare("UPDATE fund_contribution_plans SET label=?,kind=?,amount=?,currency=?,day_of_month=?,frequency=?,start_date=?,status=?,next_contribution_at=?,enabled=?,notes=?,updated_at=? WHERE id=? AND user_id=?")
      .bind(body.label!==undefined?trimText(body.label,160):existing.label,body.kind!==undefined?trimText(body.kind,30):existing.kind,amount,body.currency!==undefined?String(body.currency||"EUR").toUpperCase():existing.currency,day||null,frequency,startDate,status,next,enabled,body.notes!==undefined?trimText(body.notes,1000):existing.notes,nowIso(),id,user.id).run();
    return json({plan:await env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE id=? AND user_id=?").bind(id,user.id).first()});
  }
  if(request.method==="DELETE"){
    await env.DB.prepare("DELETE FROM fund_contribution_plans WHERE id=? AND user_id=?").bind(id,user.id).run();
    return json({deleted:true});
  }
  return json({error:"Method not allowed"},405);
}

async function handleFundPortfolios(request, env, user, json, parts) {
  await ensureFundSchema(env);
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const rows = await env.DB.prepare(
      "SELECT p.*, (SELECT COUNT(*) FROM fund_positions x WHERE x.fund_portfolio_id=p.id AND x.active=1) AS position_count " +
      "FROM fund_portfolios p WHERE p.user_id=? ORDER BY p.sort_order ASC,p.created_at ASC"
    ).bind(user.id).all();
    return json({ portfolios: rows.results || [] });
  }
  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = fundPortfolioPayload(body);
    if (!data.name) return json({ error: "Fund portfolio name is required" }, 400);
    const idNew = uid("fpf_"), now = nowIso();
    await env.DB.prepare(
      "INSERT INTO fund_portfolios (id,user_id,name,platform,base_currency,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(idNew,user.id,data.name,data.platform,data.baseCurrency,data.sortOrder,now,now).run();
    return json({ portfolio: await oneFundPortfolio(env,user.id,idNew) },201);
  }
  if (!id) return json({ error: "Fund portfolio id required" },400);
  const existing = await oneFundPortfolio(env,user.id,id);
  if (!existing) return json({ error: "Fund portfolio not found" },404);
  if (request.method === "PATCH") {
    const body = await readJson(request);
    const data = fundPortfolioPayload({
      name: body.name !== undefined ? body.name : existing.name,
      platform: body.platform !== undefined ? body.platform : existing.platform,
      baseCurrency: body.baseCurrency !== undefined ? body.baseCurrency : existing.base_currency,
      sortOrder: body.sortOrder !== undefined ? body.sortOrder : existing.sort_order
    });
    if (!data.name) return json({ error: "Fund portfolio name is required" },400);
    await env.DB.prepare(
      "UPDATE fund_portfolios SET name=?,platform=?,base_currency=?,sort_order=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(data.name,data.platform,data.baseCurrency,data.sortOrder,nowIso(),id,user.id).run();
    return json({ portfolio: await oneFundPortfolio(env,user.id,id) });
  }
  if (request.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM fund_transactions WHERE fund_portfolio_id=? AND user_id=?").bind(id,user.id),
      env.DB.prepare("DELETE FROM fund_positions WHERE fund_portfolio_id=? AND user_id=?").bind(id,user.id),
      env.DB.prepare("DELETE FROM fund_portfolios WHERE id=? AND user_id=?").bind(id,user.id)
    ]);
    return json({ deleted:true });
  }
  return json({ error:"Method not allowed" },405);
}

// Último precio conocido por operación (p. ej. ejecuciones de un plan importadas), para fondos
// sin valor liquidativo en el catálogo.
const FUND_POSITION_SELECT =
  "SELECT p.*," +
  " (SELECT t.price FROM fund_transactions t WHERE t.fund_position_id=p.id AND t.user_id=p.user_id AND t.price>0 ORDER BY t.executed_at DESC,t.created_at DESC LIMIT 1) AS last_price," +
  " (SELECT t.executed_at FROM fund_transactions t WHERE t.fund_position_id=p.id AND t.user_id=p.user_id AND t.price>0 ORDER BY t.executed_at DESC,t.created_at DESC LIMIT 1) AS last_price_at" +
  " FROM fund_positions p WHERE p.user_id=?";

async function handleFundPositions(request, env, user, json, parts, url) {
  await ensureFundSchema(env);
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const portfolioId = trimText(url.searchParams.get("portfolioId"),80);
    const stmt = portfolioId
      ? env.DB.prepare(FUND_POSITION_SELECT + " AND p.fund_portfolio_id=? AND p.active=1 ORDER BY p.created_at DESC").bind(user.id,portfolioId)
      : env.DB.prepare(FUND_POSITION_SELECT + " AND p.active=1 ORDER BY p.created_at DESC").bind(user.id);
    const rows = await stmt.all();
    return json({ positions: rows.results || [] });
  }
  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = fundPositionPayload(body);
    if (!data.fundPortfolioId || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(data.isin)) {
      return json({ error:"fundPortfolioId and valid ISIN are required" },400);
    }
    if (data.units === null || data.units < 0) return json({ error:"units must be zero or greater" },400);
    if (data.avgPrice !== null && data.avgPrice < 0) return json({ error:"avgPrice cannot be negative" },400);
    if (!(await oneFundPortfolio(env,user.id,data.fundPortfolioId))) return json({ error:"Fund portfolio not found" },404);
    const existing = await env.DB.prepare(
      "SELECT id FROM fund_positions WHERE user_id=? AND fund_portfolio_id=? AND isin=?"
    ).bind(user.id,data.fundPortfolioId,data.isin).first();
    const idNew = existing && existing.id ? existing.id : uid("fpos_"), now = nowIso();
    await env.DB.prepare(
      "INSERT INTO fund_positions (id,fund_portfolio_id,user_id,isin,name,product_type,provider,index_name,platform,units,avg_price,currency,opened_at,notes,active,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) " +
      "ON CONFLICT(fund_portfolio_id,isin) DO UPDATE SET name=excluded.name,product_type=excluded.product_type,provider=excluded.provider,index_name=excluded.index_name,platform=excluded.platform,units=excluded.units,avg_price=excluded.avg_price,currency=excluded.currency,opened_at=excluded.opened_at,notes=excluded.notes,active=1,updated_at=excluded.updated_at"
    ).bind(idNew,data.fundPortfolioId,user.id,data.isin,data.name,data.productType,data.provider,data.indexName,data.platform,data.units,data.avgPrice,data.currency,data.openedAt,data.notes,now,now).run();
    return json({ position: await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(idNew,user.id).first() },existing?200:201);
  }
  if (!id) return json({ error:"Fund position id required" },400);
  const existing = await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(id,user.id).first();
  if (!existing) return json({ error:"Fund position not found" },404);
  if (request.method === "PATCH") {
    const body = await readJson(request);
    const data = fundPositionPayload({
      fundPortfolioId: body.fundPortfolioId !== undefined ? body.fundPortfolioId : existing.fund_portfolio_id,
      isin: existing.isin,
      name: body.name !== undefined ? body.name : existing.name,
      productType: body.productType !== undefined ? body.productType : existing.product_type,
      provider: body.provider !== undefined ? body.provider : existing.provider,
      indexName: body.indexName !== undefined ? body.indexName : existing.index_name,
      platform: body.platform !== undefined ? body.platform : existing.platform,
      units: body.units !== undefined ? body.units : existing.units,
      avgPrice: body.avgPrice !== undefined ? body.avgPrice : existing.avg_price,
      currency: body.currency !== undefined ? body.currency : existing.currency,
      openedAt: body.openedAt !== undefined ? body.openedAt : existing.opened_at,
      notes: body.notes !== undefined ? body.notes : existing.notes
    });
    if (data.units === null || data.units < 0) return json({ error:"units must be zero or greater" },400);
    if (!(await oneFundPortfolio(env,user.id,data.fundPortfolioId))) return json({ error:"Fund portfolio not found" },404);
    await env.DB.prepare(
      "UPDATE fund_positions SET fund_portfolio_id=?,name=?,product_type=?,provider=?,index_name=?,platform=?,units=?,avg_price=?,currency=?,opened_at=?,notes=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(data.fundPortfolioId,data.name,data.productType,data.provider,data.indexName,data.platform,data.units,data.avgPrice,data.currency,data.openedAt,data.notes,nowIso(),id,user.id).run();
    return json({ position: await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(id,user.id).first() });
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE fund_positions SET active=0,updated_at=? WHERE id=? AND user_id=?").bind(nowIso(),id,user.id).run();
    return json({ deleted:true });
  }
  return json({ error:"Method not allowed" },405);
}


export function calculateFundLedger(rows) {
  let units=0,costBasis=0,realized=0,currency="EUR",firstBuyAt=null,totalFees=0;
  for(const row of rows||[]){
    const side=String(row.side||"").toUpperCase();
    const qty=finiteNumber(row.units),price=finiteNumber(row.price),fees=Math.max(0,finiteNumber(row.fees)||0);
    const cur=String(row.currency||currency||"EUR").toUpperCase();
    if(qty===null||qty<=0||price===null||price<0)continue;
    if(units>1e-8&&cur!==currency)throw new Error("Fund transaction currency differs from current position");
    if(units<=1e-8)currency=cur;
    totalFees+=fees;
    if(side==="BUY"){
      if(!firstBuyAt)firstBuyAt=row.executed_at||row.created_at||null;
      units+=qty;
      costBasis+=qty*price+fees;
    }else if(side==="SELL"){
      if(qty>units+1e-8)throw new Error("Sell units exceed current fund position");
      const avg=units>1e-8?costBasis/units:0;
      realized+=qty*price-fees-qty*avg;
      units-=qty;
      costBasis-=qty*avg;
      if(units<=1e-8){units=0;costBasis=0}
    }
  }
  return {units,avgPrice:units>1e-8?costBasis/units:null,invested:costBasis,realizedPnl:realized,totalFees,currency,firstBuyAt};
}

async function fundTransactionRows(env,userId,positionId){
  await ensureFundSchema(env);
  const rows=await env.DB.prepare(
    "SELECT * FROM fund_transactions WHERE user_id=? AND fund_position_id=? ORDER BY executed_at ASC,created_at ASC,id ASC"
  ).bind(userId,positionId).all();
  return rows.results||[];
}

async function ensureFundOpeningTransaction(env,userId,position){
  if(!position)return;
  const existing=await env.DB.prepare("SELECT id FROM fund_transactions WHERE user_id=? AND fund_position_id=? LIMIT 1").bind(userId,position.id).first();
  if(existing)return;
  const units=finiteNumber(position.units),avg=finiteNumber(position.avg_price);
  if(units===null||units<=0||avg===null||avg<0)return;
  const now=nowIso(),executed=position.opened_at||position.created_at||now;
  await env.DB.prepare(
    "INSERT INTO fund_transactions (id,fund_portfolio_id,fund_position_id,user_id,isin,side,units,price,fees,currency,executed_at,notes,created_at,updated_at) VALUES (?,?,?,?,?,'BUY',?,?,?,?,?,?,?,?)"
  ).bind(uid("ftx_seed_"),position.fund_portfolio_id,position.id,userId,position.isin,units,avg,0,String(position.currency||"EUR").toUpperCase(),executed,"Saldo inicial importado",now,now).run();
}

async function recalculateFundPosition(env,userId,positionId){
  const existing=await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(positionId,userId).first();
  if(!existing)return null;
  const ledger=calculateFundLedger(await fundTransactionRows(env,userId,positionId));
  await env.DB.prepare(
    "UPDATE fund_positions SET units=?,avg_price=?,currency=?,opened_at=?,active=?,updated_at=? WHERE id=? AND user_id=?"
  ).bind(ledger.units,ledger.avgPrice,ledger.currency,ledger.firstBuyAt,ledger.units>1e-8?1:0,nowIso(),positionId,userId).run();
  return {position:await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(positionId,userId).first(),ledger};
}

/* Import fund / ETF / ETC operations from a broker file (Trade Republic CSV): the
 * fund portfolio of that platform is created if needed, one position per ISIN, and
 * savings plans are detected from the plan executions (amount, day and frequency). */
async function fundPortfolioForPlatform(env,userId,platform){
  const rows=(await env.DB.prepare("SELECT * FROM fund_portfolios WHERE user_id=? ORDER BY sort_order,created_at").bind(userId).all()).results||[];
  const want=String(platform||"").toLowerCase();
  const hit=want&&rows.find(r=>String(r.platform||"").toLowerCase()===want||String(r.name||"").toLowerCase().includes(want));
  if(hit)return hit;
  if(!want&&rows.length)return rows[0];
  const id=uid("fpf_"),now=nowIso();
  await env.DB.prepare("INSERT INTO fund_portfolios (id,user_id,name,platform,base_currency,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id,userId,(platform?platform+" · ":"")+"Fondos y ETFs",trimText(platform,80),"EUR",rows.length,now,now).run();
  return await env.DB.prepare("SELECT * FROM fund_portfolios WHERE id=?").bind(id).first();
}
// Notas del plan importado: «Detectado…» permite que la siguiente importación lo actualice.
function planNotes(plan,previous){
  const base="Detectado en la importación ("+plan.count+(plan.count===1?" ejecución)":" ejecuciones)")+(plan.note?" · "+plan.note:"");
  return previous&&!String(previous).startsWith("Detectado")?String(previous):base;
}
export function detectSavingsPlans(rows,nowMs=Date.now()){
  const byIsin=new Map();
  for(const r of rows||[]){
    const isin=String(r.isin||"").toUpperCase(),t=Date.parse(r.executedAt);
    const amount=(Number(r.units)||0)*(Number(r.price)||0)+(Number(r.fees)||0);
    if(!isin||!Number.isFinite(t)||!(amount>0))continue;
    if(String(r.side||"BUY").toUpperCase()!=="BUY")continue;
    if(r.benefit)continue; // Saveback y Redondeo no son el plan, aunque inviertan en el mismo producto
    if(!byIsin.has(isin))byIsin.set(isin,[]);
    byIsin.get(isin).push({t,amount,currency:String(r.currency||"EUR").toUpperCase(),plan:r.plan===true});
  }
  const out=[];
  const median=a=>{const b=a.slice().sort((x,y)=>x-y);const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2};
  for(const [isin,all] of byIsin){
    all.sort((a,b)=>a.t-b.t);
    // Rows the broker marks as plan executions; otherwise infer the plan from regular
    // buys: at least 3, evenly spaced (6-100 days) and of an almost fixed amount.
    // A single execution the broker labels as plan is enough (a plan started last month).
    const flagged=all.filter(x=>x.plan);
    let list=flagged.length>=1?flagged:null;
    if(!list){
      const recent=all.slice(-6);
      // Two buys a month apart of the same amount on the same day: a monthly plan whose
      // executions the export does not label (Trade Republic's newer CSV lists them as BUY).
      if(recent.length===2){
        const gap=(recent[1].t-recent[0].t)/864e5,a0=recent[0].amount,a1=recent[1].amount;
        const sameDay=Math.abs(new Date(recent[0].t).getUTCDate()-new Date(recent[1].t).getUTCDate())<=3; // weekends move it
        if(!(gap>=26&&gap<=35&&sameDay&&Math.abs(a0-a1)<=Math.max(a0,a1)*0.02))continue;
        list=recent;
      }
      if(!list&&recent.length<3)continue;
      const g=[];for(let i=1;i<recent.length;i++)g.push((recent[i].t-recent[i-1].t)/864e5);
      const mg=median(g),ma=median(recent.map(x=>x.amount));
      if(!(mg>=6&&mg<=100))continue;
      if(g.some(x=>Math.abs(x-mg)>mg*.45))continue;
      if(recent.some(x=>Math.abs(x.amount-ma)>ma*.15))continue;
      list=recent;
    }
    const last=list[list.length-1];
    if(nowMs-last.t>62*864e5)continue; // stopped plans are not recreated
    const recent=list.slice(-4);
    const gaps=[];for(let i=1;i<recent.length;i++)gaps.push((recent[i].t-recent[i-1].t)/864e5);
    const gap=median(gaps);
    const frequency=!Number.isFinite(gap)?"monthly":gap<10?"weekly":gap>70&&gap<120?"quarterly":"monthly";
    const days=recent.map(x=>new Date(x.t).getUTCDate());
    const day=days.sort((a,b)=>days.filter(v=>v===b).length-days.filter(v=>v===a).length)[0];
    out.push({isin,amount:Math.round(last.amount*100)/100,currency:last.currency,frequency,dayOfMonth:day,count:list.length,lastAt:new Date(last.t).toISOString()});
  }
  return out;
}

// ---------------------------------------------------------------------------
// Catálogo aprendido: fondos que aparecen en importaciones y no figuran en el catálogo
// público (p. ej. fondos de inversión de Trade Republic). Solo ISIN, nombre, tipo y la
// plataforma donde se ha visto: no guarda nada del usuario que lo importó.
// ---------------------------------------------------------------------------
let fundCatalogExtraReady=false;
async function ensureFundCatalogExtra(env){
  if(fundCatalogExtraReady)return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fund_catalog_extra (isin TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',type TEXT NOT NULL DEFAULT 'fund',provider TEXT NOT NULL DEFAULT '',index_name TEXT NOT NULL DEFAULT '',currency TEXT NOT NULL DEFAULT 'EUR',tr_seen INTEGER NOT NULL DEFAULT 0,mi_seen INTEGER NOT NULL DEFAULT 0,last_price REAL,last_price_at TEXT,ter REAL,nav REAL,nav_date TEXT,ret_1y REAL,ms_name TEXT,enriched_at TEXT,updated_at TEXT NOT NULL)").run();
  fundCatalogExtraReady=true;
}
function platformFlags(platform){
  const p=String(platform||"").toLowerCase();
  return {tr:/trade\s*republic|^tr$/.test(p)?1:0,mi:/myinvestor/.test(p)?1:0};
}
async function learnFundProduct(env,row,platform){
  const isin=trimText(row&&row.isin,12).toUpperCase();
  if(!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))return;
  await ensureFundCatalogExtra(env);
  const f=platformFlags(platform),type=["fund","etf","etp"].includes(String(row.productType))?String(row.productType):"fund";
  const price=finiteNumber(row.price),when=String(row.executedAt||"");
  await env.DB.prepare(
    "INSERT INTO fund_catalog_extra (isin,name,type,provider,index_name,currency,tr_seen,mi_seen,last_price,last_price_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) "+
    "ON CONFLICT(isin) DO UPDATE SET name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE fund_catalog_extra.name END,"+
    "tr_seen=MAX(fund_catalog_extra.tr_seen,excluded.tr_seen),mi_seen=MAX(fund_catalog_extra.mi_seen,excluded.mi_seen),"+
    "last_price=CASE WHEN excluded.last_price_at>COALESCE(fund_catalog_extra.last_price_at,'') THEN excluded.last_price ELSE fund_catalog_extra.last_price END,"+
    "last_price_at=MAX(COALESCE(fund_catalog_extra.last_price_at,''),COALESCE(excluded.last_price_at,'')),updated_at=excluded.updated_at"
  ).bind(isin,trimText(row.name,160),type,trimText(row.provider,80),trimText(row.indexName,120),String(row.currency||"EUR").toUpperCase().slice(0,3),f.tr,f.mi,price!==null&&price>0?price:null,price!==null&&price>0&&when?when:null,nowIso()).run();
}
// Valor liquidativo, comisión (TER) y rentabilidad a 1 año del screener público de Morningstar
// (universo de fondos registrados en España). Como mucho una vez cada 20 h por fondo.
const MS_SCREENER="https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener";
async function enrichFundCatalogExtra(env){
  const stale=new Date(Date.now()-20*3600e3).toISOString();
  const due=await env.DB.prepare("SELECT isin FROM fund_catalog_extra WHERE enriched_at IS NULL OR enriched_at<? LIMIT 60").bind(stale).all();
  const isins=(due.results||[]).map(r=>r.isin).filter(x=>/^[A-Z]{2}[A-Z0-9]{10}$/.test(x));
  if(!isins.length)return 0;
  const params=new URLSearchParams({outputType:"json",version:"1",languageId:"es-ES",currencyId:"EUR",universeIds:"FOESP$$ALL",
    securityDataPoints:"SecId|Name|isin|OngoingCharge|ClosePrice|ClosePriceDate|ReturnM12",filters:"ISIN:IN:"+isins.join(":"),page:"1",pageSize:String(isins.length)});
  const res=await fetch(MS_SCREENER+"?"+params.toString(),{headers:{"Accept":"application/json","User-Agent":"Mozilla/5.0 ViewInvAI"},signal:AbortSignal.timeout(9000)});
  if(!res.ok)throw new Error("Morningstar "+res.status);
  const data=await res.json();
  const now=nowIso(),found=new Set();
  for(const r of data&&data.rows||[]){
    const isin=String(r.isin||"").toUpperCase();if(!isins.includes(isin))continue;found.add(isin);
    await env.DB.prepare("UPDATE fund_catalog_extra SET ter=?,nav=?,nav_date=?,ret_1y=?,ms_name=?,enriched_at=? WHERE isin=?")
      .bind(finiteNumber(r.OngoingCharge),finiteNumber(r.ClosePrice),trimText(r.ClosePriceDate,20)||null,finiteNumber(r.ReturnM12),trimText(r.Name,160),now,isin).run();
  }
  // Sin datos: no se vuelve a preguntar hasta el próximo ciclo.
  for(const isin of isins)if(!found.has(isin))await env.DB.prepare("UPDATE fund_catalog_extra SET enriched_at=? WHERE isin=?").bind(now,isin).run();
  return found.size;
}
async function handleFundCatalogExtra(request,env,user,json){
  if(request.method!=="GET")return json({error:"Method not allowed"},405);
  await ensureFundCatalogExtra(env);
  // Lo que ya tienes en tus carteras de fondos (importaciones anteriores) también enseña al catálogo.
  try{
    await ensureFundSchema(env);
    const mine=await env.DB.prepare("SELECT isin,name,product_type,provider,index_name,currency,platform FROM fund_positions WHERE user_id=? AND active=1").bind(user.id).all();
    for(const p of mine.results||[])await learnFundProduct(env,{isin:p.isin,name:p.name,productType:p.product_type,provider:p.provider,indexName:p.index_name,currency:p.currency},p.platform);
  }catch(_){}
  try{await enrichFundCatalogExtra(env)}catch(error){console.warn("Fund enrichment failed",String(error&&error.message||error))}
  const rows=await env.DB.prepare("SELECT * FROM fund_catalog_extra ORDER BY name LIMIT 5000").all();
  return json({products:rows.results||[]});
}
async function handleFundTransactionImport(request,env,user,json){
  const body=await readJson(request);
  const rows=Array.isArray(body.rows)?body.rows.slice(0,IMPORT_MAX_ROWS):[];
  const source=["tr","ibkr","csv","backup"].includes(String(body.source||""))?String(body.source):"csv";
  const platform=trimText(body.platform,80);
  const portfolio=body.fundPortfolioId
    ? await oneFundPortfolio(env,user.id,trimText(body.fundPortfolioId,80))
    : await fundPortfolioForPlatform(env,user.id,platform);
  if(!portfolio)return json({error:"Fund portfolio not found"},404);
  let imported=0,skipped=0,plans=0;const errors=[],touched=new Set(),retiredFor=new Set();
  const ordered=rows.slice().sort((a,b)=>(Date.parse(a&&a.executedAt)||0)-(Date.parse(b&&b.executedAt)||0)||(String(a&&a.side).toUpperCase()==="BUY"?-1:1));
  const positionFor=async r=>{
    const isin=trimText(r.isin,12).toUpperCase();
    let pos=await env.DB.prepare("SELECT * FROM fund_positions WHERE user_id=? AND fund_portfolio_id=? AND isin=?").bind(user.id,portfolio.id,isin).first();
    if(!pos){
      const id=uid("fpos_"),now=nowIso(),type=["fund","etf","etp"].includes(String(r.productType))?String(r.productType):"fund";
      await env.DB.prepare("INSERT INTO fund_positions (id,fund_portfolio_id,user_id,isin,name,product_type,provider,index_name,platform,units,avg_price,currency,opened_at,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,NULL,?,?,?,1,?,?)")
        .bind(id,portfolio.id,user.id,isin,trimText(r.name,160),type,trimText(r.provider,80),trimText(r.indexName,120),platform,String(r.currency||"EUR").toUpperCase(),null,"Importado de "+(platform||"tu bróker"),now,now).run();
      pos=await env.DB.prepare("SELECT * FROM fund_positions WHERE id=?").bind(id).first();
    }
    return pos;
  };
  for(const r of ordered){
    const externalId=trimText(r&&r.externalId,120);
    const isin=trimText(r&&r.isin,12).toUpperCase();
    const side=String(r&&r.side||"").toUpperCase(),units=finiteNumber(r&&r.units),price=finiteNumber(r&&r.price),fees=Math.max(0,finiteNumber(r&&r.fees)||0);
    const when=new Date(String(r&&r.executedAt||""));
    if(!externalId||!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)||!["BUY","SELL"].includes(side)||!(units>0)||price===null||price<0||!Number.isFinite(when.getTime())){
      errors.push({ticker:isin||externalId,error:"Operación de fondo incompleta"});continue;
    }
    const label=r.benefit==="saveback"?"Saveback":r.benefit==="roundup"?"Redondeo":r.plan?"Plan de ahorro":"Importado";
    const dup=await env.DB.prepare("SELECT id,notes FROM fund_transactions WHERE user_id=? AND external_id=?").bind(user.id,externalId).first();
    if(dup){
      skipped++;
      // Ya importada: si ahora se sabe mejor qué es (plan, Saveback, Redondeo), se corrige la etiqueta.
      if(dup.notes!==label&&["Saveback","Redondeo","Plan de ahorro","Importado"].includes(String(dup.notes||"")))
        await env.DB.prepare("UPDATE fund_transactions SET notes=?,updated_at=? WHERE id=?").bind(label,nowIso(),dup.id).run();
      try{await learnFundProduct(env,r,platform)}catch(_){}
      continue;
    }
    try{
      const pos=await positionFor(r);
      if(body.replaceManual===true&&!retiredFor.has(pos.id)){
        retiredFor.add(pos.id);
        await env.DB.prepare("DELETE FROM fund_transactions WHERE user_id=? AND fund_position_id=? AND external_id=''").bind(user.id,pos.id).run();
      }
      const now=nowIso();
      await env.DB.prepare("INSERT INTO fund_transactions (id,fund_portfolio_id,fund_position_id,user_id,isin,side,units,price,fees,currency,executed_at,notes,external_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(uid("ftx_"),portfolio.id,pos.id,user.id,isin,side,units,price,fees,String(r.currency||"EUR").toUpperCase(),when.toISOString(),label,externalId,now,now).run();
      touched.add(pos.id);imported++;
      try{await learnFundProduct(env,r,platform)}catch(_){}
    }catch(error){
      if(/UNIQUE/i.test(String(error&&error.message)))skipped++;
      else errors.push({ticker:isin,error:"No se pudo guardar: "+String(error&&error.message||"").slice(0,90)});
    }
  }
  for(const id of touched){try{await recalculateFundPosition(env,user.id,id)}catch(_){}}
  // Planes: los que la app ya ha confirmado contigo (body.plans) o, de clientes antiguos,
  // los detectados aquí. El importe vigente es el de la última ejecución.
  const explicitPlans=Array.isArray(body.plans);
  const planList=explicitPlans?body.plans.slice(0,50).map(p=>({isin:trimText(p&&p.isin,12).toUpperCase(),amount:finiteNumber(p&&p.amount),currency:String(p&&p.currency||"EUR").toUpperCase().slice(0,3),
      dayOfMonth:Math.min(28,Math.max(1,Math.round(Number(p&&p.dayOfMonth)||1))),frequency:["weekly","monthly","quarterly"].includes(p&&p.frequency)?p.frequency:"monthly",count:Math.max(1,Math.round(Number(p&&p.count)||1)),lastAt:String(p&&p.lastAt||nowIso()),note:trimText(p&&p.note,80)}))
      .filter(p=>/^[A-Z]{2}[A-Z0-9]{10}$/.test(p.isin)&&p.amount>0&&Number.isFinite(Date.parse(p.lastAt)))
    :body.detectPlans===true&&Array.isArray(body.allRows)?detectSavingsPlans(body.allRows):[];
  // Lo que confirmaste que no es un plan: se quita el plan detectado automáticamente antes.
  for(const isin of (Array.isArray(body.noPlans)?body.noPlans:[]).slice(0,50)){
    const code=trimText(isin,12).toUpperCase();if(!/^[A-Z]{2}[A-Z0-9]{10}$/.test(code))continue;
    await env.DB.prepare("DELETE FROM fund_contribution_plans WHERE user_id=? AND fund_portfolio_id=? AND isin=? AND notes LIKE 'Detectado%'").bind(user.id,portfolio.id,code).run();
  }
  {
    for(const plan of planList){
      const pos=await env.DB.prepare("SELECT * FROM fund_positions WHERE user_id=? AND fund_portfolio_id=? AND isin=?").bind(user.id,portfolio.id,plan.isin).first();
      if(!pos)continue;
      const existing=await env.DB.prepare("SELECT id,notes FROM fund_contribution_plans WHERE user_id=? AND fund_position_id=? AND kind NOT IN ('saveback','roundup') ORDER BY created_at LIMIT 1").bind(user.id,pos.id).first();
      const next=contributionNextDate(null,plan.dayOfMonth,plan.frequency);
      const now=nowIso();
      if(existing){
        if(explicitPlans||String(existing.notes||"").startsWith("Detectado"))await env.DB.prepare("UPDATE fund_contribution_plans SET amount=?,currency=?,day_of_month=?,frequency=?,next_contribution_at=?,status='active',enabled=1,notes=?,updated_at=? WHERE id=?")
          .bind(plan.amount,plan.currency,plan.dayOfMonth,plan.frequency,next,planNotes(plan,existing.notes),now,existing.id).run();
        continue;
      }
      await env.DB.prepare("INSERT INTO fund_contribution_plans (id,fund_portfolio_id,fund_position_id,user_id,isin,label,kind,amount,currency,day_of_month,frequency,start_date,status,next_contribution_at,enabled,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(uid("fplan_"),portfolio.id,pos.id,user.id,plan.isin,"Plan "+(platform||"")+" · "+String(pos.name||plan.isin).slice(0,80),"monthly",plan.amount,plan.currency,plan.dayOfMonth,plan.frequency,plan.lastAt.slice(0,10),"active",next,1,planNotes(plan,""),now,now).run();
      plans++;
    }
  }
  return json({imported,skipped,plans,errors:errors.slice(0,20),fundPortfolioId:portfolio.id});
}

async function handleFundTransactions(request,env,user,json,parts,url){
  await ensureFundSchema(env);
  const id=parts[1]||"";
  if(request.method==="POST"&&id==="import")return handleFundTransactionImport(request,env,user,json);
  if(request.method==="GET"&&!id){
    const positionId=trimText(url.searchParams.get("positionId"),80);
    const portfolioId=trimText(url.searchParams.get("portfolioId"),80);
    let rows;
    if(positionId){
      rows=await env.DB.prepare("SELECT * FROM fund_transactions WHERE user_id=? AND fund_position_id=? ORDER BY executed_at DESC,created_at DESC").bind(user.id,positionId).all();
      return json({transactions:rows.results||[],summary:calculateFundLedger(await fundTransactionRows(env,user.id,positionId))});
    }
    if(portfolioId){
      rows=await env.DB.prepare("SELECT * FROM fund_transactions WHERE user_id=? AND fund_portfolio_id=? ORDER BY executed_at DESC,created_at DESC").bind(user.id,portfolioId).all();
    }else{
      rows=await env.DB.prepare("SELECT * FROM fund_transactions WHERE user_id=? ORDER BY executed_at DESC,created_at DESC LIMIT 500").bind(user.id).all();
    }
    return json({transactions:rows.results||[]});
  }
  if(request.method==="POST"&&!id){
    const body=await readJson(request);
    const positionId=trimText(body.positionId,80);
    const side=String(body.side||"").toUpperCase();
    const units=finiteNumber(body.units),price=finiteNumber(body.price),fees=Math.max(0,finiteNumber(body.fees)||0);
    const currency=/^[A-Z]{3}$/.test(String(body.currency||"EUR").toUpperCase())?String(body.currency||"EUR").toUpperCase():"EUR";
    const dateRaw=trimText(body.executedAt,40),date=dateRaw?new Date(dateRaw):new Date();
    if(!["BUY","SELL"].includes(side))return json({error:"side must be BUY or SELL"},400);
    if(units===null||units<=0)return json({error:"units must be greater than zero"},400);
    if(price===null||price<0)return json({error:"price must be zero or greater"},400);
    if(!Number.isFinite(date.getTime()))return json({error:"executedAt is invalid"},400);
    const position=await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(positionId,user.id).first();
    if(!position)return json({error:"Fund position not found"},404);
    await ensureFundOpeningTransaction(env,user.id,position);
    const before=calculateFundLedger(await fundTransactionRows(env,user.id,positionId));
    if(side==="SELL"&&units>before.units+1e-8)return json({error:"Sell units exceed current fund position"},400);
    if(before.units>1e-8&&before.currency!==currency)return json({error:"Transaction currency must match the fund position"},400);
    const txId=uid("ftx_"),now=nowIso();
    await env.DB.prepare(
      "INSERT INTO fund_transactions (id,fund_portfolio_id,fund_position_id,user_id,isin,side,units,price,fees,currency,executed_at,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(txId,position.fund_portfolio_id,position.id,user.id,position.isin,side,units,price,fees,currency,date.toISOString(),trimText(body.notes,1000),now,now).run();
    const recalculated=await recalculateFundPosition(env,user.id,position.id);
    return json({transaction:await env.DB.prepare("SELECT * FROM fund_transactions WHERE id=? AND user_id=?").bind(txId,user.id).first(),position:recalculated&&recalculated.position,summary:recalculated&&recalculated.ledger},201);
  }
  if(!id)return json({error:"Fund transaction id required"},400);
  const existing=await env.DB.prepare("SELECT * FROM fund_transactions WHERE id=? AND user_id=?").bind(id,user.id).first();
  if(!existing)return json({error:"Fund transaction not found"},404);
  if(request.method==="DELETE"){
    await env.DB.prepare("DELETE FROM fund_transactions WHERE id=? AND user_id=?").bind(id,user.id).run();
    const recalculated=await recalculateFundPosition(env,user.id,existing.fund_position_id);
    return json({deleted:true,position:recalculated&&recalculated.position,summary:recalculated&&recalculated.ledger});
  }
  return json({error:"Method not allowed"},405);
}

async function handleWatchlist(request, env, user, json, parts) {
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const rows = await env.DB.prepare("SELECT * FROM watchlist WHERE user_id=? ORDER BY created_at DESC").bind(user.id).all();
    return json({ watchlist: rows.results || [] });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = watchPayload(body);
    if (!data.stockKey || !data.ticker) return json({ error: "stockKey and ticker are required" }, 400);
    const existing = await env.DB.prepare("SELECT id FROM watchlist WHERE user_id=? AND stock_key=?").bind(user.id, data.stockKey).first();
    const idNew = existing && existing.id ? existing.id : uid("wl_");
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO watchlist (id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(user_id,stock_key) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,exchange=excluded.exchange,isin=excluded.isin,prefer_tr=excluded.prefer_tr,notes=excluded.notes,updated_at=excluded.updated_at"
    ).bind(idNew, user.id, data.stockKey, data.ticker, data.name, data.exchange, data.isin, data.preferTr, data.notes, now, now).run();
    return json({ item: await env.DB.prepare("SELECT * FROM watchlist WHERE id=? AND user_id=?").bind(idNew, user.id).first() }, existing ? 200 : 201);
  }

  if (!id) return json({ error: "Watchlist id required" }, 400);
  const existing = await env.DB.prepare("SELECT * FROM watchlist WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!existing) return json({ error: "Watchlist item not found" }, 404);

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const data = watchPayload({
      stockKey: existing.stock_key,
      ticker: body.ticker !== undefined ? body.ticker : existing.ticker,
      name: body.name !== undefined ? body.name : existing.name,
      exchange: body.exchange !== undefined ? body.exchange : existing.exchange,
      isin: body.isin !== undefined ? body.isin : existing.isin,
      preferTr: body.preferTr !== undefined ? body.preferTr : existing.prefer_tr,
      notes: body.notes !== undefined ? body.notes : existing.notes
    });
    await env.DB.prepare(
      "UPDATE watchlist SET ticker=?,name=?,exchange=?,isin=?,prefer_tr=?,notes=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(data.ticker, data.name, data.exchange, data.isin, data.preferTr, data.notes, nowIso(), id, user.id).run();
    return json({ item: await env.DB.prepare("SELECT * FROM watchlist WHERE id=? AND user_id=?").bind(id, user.id).first() });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM watchlist WHERE id=? AND user_id=?").bind(id, user.id).run();
    return json({ deleted: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleAnalysisList(request, env, user, json, url) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const stockKey = trimText(url.searchParams.get("stockKey"), 80).toUpperCase();
  const limit = Math.max(1, Math.min(100, Math.round(finiteNumber(url.searchParams.get("limit")) || 30)));
  const rows = stockKey
    ? await env.DB.prepare("SELECT * FROM analysis_snapshots WHERE user_id=? AND stock_key=? ORDER BY created_at DESC LIMIT ?").bind(user.id, stockKey, limit).all()
    : await env.DB.prepare("SELECT * FROM analysis_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT ?").bind(user.id, limit).all();
  return json({ analysis: rows.results || [] });
}

async function handleAlerts(request, env, user, json, parts) {
  const action = parts[1] || "";
  if (request.method === "GET" && !action) {
    const rows = await env.DB.prepare(
      "SELECT id,stock_key,ticker,name,alert_type,severity,title,message,created_at,read_at FROM alert_events WHERE user_id=? ORDER BY created_at DESC LIMIT 150"
    ).bind(user.id).all();
    const unread = await env.DB.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE user_id=? AND read_at IS NULL").bind(user.id).first();
    return json({ alerts: rows.results || [], unread: Number(unread && unread.n) || 0 });
  }

  if (request.method === "POST" && action === "read") {
    const body = await readJson(request);
    if (body.all === true) {
      const r = await env.DB.prepare("UPDATE alert_events SET read_at=? WHERE user_id=? AND read_at IS NULL").bind(nowIso(), user.id).run();
      return json({ updated: Number(r && r.meta && r.meta.changes) || 0 });
    }
    const ids = Array.isArray(body.ids) ? body.ids.map(x => trimText(x, 80)).filter(Boolean).slice(0, 100) : [];
    if (!ids.length) return json({ updated: 0 });
    const stamp = nowIso();
    await env.DB.batch(ids.map(id => env.DB.prepare("UPDATE alert_events SET read_at=? WHERE id=? AND user_id=?").bind(stamp, id, user.id)));
    return json({ updated: ids.length });
  }

  return json({ error: "Method not allowed" }, 405);
}

function findStock(snapshot, target) {
  const stocks = snapshot && Array.isArray(snapshot.stocks) ? snapshot.stocks : [];
  const wanted = String(target.stock_key || "").toUpperCase();
  if (wanted) {
    const exact = stocks.find(s => String(s.tvSymbol || ((s.exchange || "") + ":" + (s.ticker || ""))).toUpperCase() === wanted);
    if (exact) return exact;
  }
  const ticker = String(target.ticker || "").toUpperCase();
  return stocks.find(s => String(s.ticker || "").toUpperCase() === ticker) || null;
}

function recentEvents(snapshot, stock, limit = 12) {
  const ticker = String(stock && stock.ticker || "").toUpperCase();
  const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : [];
  return events.filter(e => String(e.ticker || "").toUpperCase() === ticker)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, limit)
    .map(e => ({
      id: trimText(e.id || "", 160),
      date: e.date || null,
      eventKind: e.eventKind || (e.type === "news" ? "news" : "event"),
      type: e.type || e.eventKind || "event",
      title: trimText(e.title || e.fact || "", 240),
      fact: trimText(e.fact || e.title || "", 300),
      impact: trimText(e.hypothesis || e.impact || e.context || (e.type === "earnings" ? "Resultados y guidance pueden cambiar rápidamente las expectativas de valoración y volatilidad." : ""), 260),
      impactScore: finiteNumber(e.impactScore),
      verification: trimText(e.verification || "", 180),
      sourceCount: finiteNumber(e.sourceCount),
      independentSourceCount: finiteNumber(e.independentSourceCount),
      corroborated: e.corroborated === true,
      source: trimText(e.source || "", 120),
      url: trimText(e.url || e.sourceUrl || "", 500)
    }));
}

function mergeEventRows(primary,extra,limit=24){
  const rows=[...(Array.isArray(primary)?primary:[]),...(Array.isArray(extra)?extra:[])];
  const seen=new Set(),out=[];
  for(const raw of rows.sort((a,b)=>new Date(b&&b.date||0)-new Date(a&&a.date||0))){
    if(!raw)continue;
    const title=trimText(raw.title||raw.fact||"",240);
    const date=raw.date||null;
    if(!title||!date)continue;
    const key=String(raw.id||"").trim()||[String(raw.eventKind||raw.type||""),title.toLowerCase(),String(date).slice(0,16)].join("|");
    if(seen.has(key))continue;
    seen.add(key);
    out.push({
      id:trimText(raw.id||key,160),
      date,
      eventKind:raw.eventKind||(raw.type==="news"?"news":"event"),
      type:raw.type||raw.eventKind||"event",
      title,
      fact:trimText(raw.fact||title,300),
      impact:trimText(raw.hypothesis||raw.impact||raw.context||"",260),
      impactScore:finiteNumber(raw.impactScore),
      verification:trimText(raw.verification||"",180),
      sourceCount:finiteNumber(raw.sourceCount),
      independentSourceCount:finiteNumber(raw.independentSourceCount),
      corroborated:raw.corroborated===true,
      source:trimText(raw.source||"",120),
      sourceFamily:trimText(raw.sourceFamily||"",40),
      official:raw.official===true||["sec","fda","clinicaltrials"].includes(String(raw.sourceFamily||"").toLowerCase())||/official|oficial|sec \/ edgar|clinicaltrials|fda/i.test(String(raw.verification||"")),
      url:trimText(raw.url||raw.sourceUrl||"",500)
    });
    if(out.length>=limit)break;
  }
  return out;
}

function average(values) {
  const a = values.map(finiteNumber).filter(v => v !== null);
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}

function chartFeatures(chart) {
  const raw = chart && Array.isArray(chart.points) ? chart.points : [];
  const points = raw.map(p => ({
    price: finiteNumber(p.close !== undefined ? p.close : p.price),
    volume: finiteNumber(p.volume)
  })).filter(p => p.price !== null).slice(-240);
  if (points.length < 20) return { available: false, points: points.length };

  const closes = points.map(p => p.price);
  const last = closes[closes.length - 1];
  const sma10 = average(closes.slice(-10));
  const sma30 = average(closes.slice(-30));
  const base20 = closes[Math.max(0, closes.length - 21)];
  const return20 = base20 > 0 ? (last / base20 - 1) * 100 : null;
  const hi30 = Math.max(...closes.slice(-30));
  const lo30 = Math.min(...closes.slice(-30));
  const drawdown30 = hi30 > 0 ? (last / hi30 - 1) * 100 : null;
  const rangePosition = hi30 > lo30 ? (last - lo30) / (hi30 - lo30) : 0.5;
  const recentVol = average(points.slice(-8).map(p => p.volume));
  const priorVol = average(points.slice(-28, -8).map(p => p.volume));
  const volumeExpansion = recentVol !== null && priorVol > 0 ? recentVol / priorVol : null;

  return {
    available: true,
    points: points.length,
    last,
    sma10,
    sma30,
    trendUp: last > sma10 && sma10 > sma30,
    return20,
    drawdown30,
    rangePosition,
    volumeExpansion
  };
}

function deterministicAssessment(target, stock, chart, events) {
  const engine = globalThis.ViewInvAIScore;
  const preferTr = Number(target.prefer_tr) === 1;
  const price = preferTr
    ? finiteNumber(stock.trLivePrice) ?? (chart && chart.available ? finiteNumber(chart.last) : null)
    : finiteNumber(stock.usLivePrice);
  const change = preferTr
    ? finiteNumber(stock.trLiveChangePct) ?? (chart && chart.available ? finiteNumber(chart.return20) : null)
    : finiteNumber(stock.usLiveChangePct);
  const bid = preferTr ? finiteNumber(stock.trLiveBid) : finiteNumber(stock.usLiveBid);
  const ask = preferTr ? finiteNumber(stock.trLiveAsk) : finiteNumber(stock.usLiveAsk);
  const spread = bid !== null && ask !== null && ask >= bid && (ask + bid) > 0
    ? (ask - bid) / ((ask + bid) / 2) * 100
    : null;

  const input = {
    price,
    change,
    volume: preferTr ? null : finiteNumber(stock.usLiveVolume),
    avgVolume: finiteNumber(stock.avgVolume),
    relVolume: finiteNumber(stock.relVolume),
    rsi: finiteNumber(stock.rsi),
    adx: finiteNumber(stock.adx),
    ema20: finiteNumber(stock.ema20),
    ema50: finiteNumber(stock.ema50),
    perfWeek: finiteNumber(stock.perfWeek),
    perfMonth: finiteNumber(stock.perfMonth),
    spread,
    bid,
    ask,
    chartAvailable: !!(chart && chart.available)
  };

  if (!engine || typeof engine.analyze !== "function") {
    return {
      signal: target.subject_type === "position" ? "REVIEW" : "WATCH",
      confidence: 50,
      score: 50,
      quality: 0,
      horizon: "1-2d",
      thesis: "El motor compartido de puntuación no está disponible temporalmente.",
      riskSummary: "No se emite una señal fuerte sin el motor determinista.",
      reasons: [],
      catalysts: events.slice(0, 4).map(e => e.title).filter(Boolean),
      engine: "score-engine-unavailable",
      model: ""
    };
  }

  const assessment = engine.analyze(input, events);
  const quality = assessment.quality && finiteNumber(assessment.quality.score) !== null ? assessment.quality.score : 0;
  const isPosition = target.subject_type === "position";
  const rawSignal = isPosition
    ? engine.positionSignal(assessment.score, quality)
    : engine.watchSignal(assessment.score, quality);
  const signal = isPosition ? rawSignal : (rawSignal === "WAIT" ? "WATCH" : rawSignal);
  const distance = Math.abs(assessment.score - 50);
  const confidence = Math.max(50, Math.min(95, Math.round(48 + distance * 0.65 + quality * 0.18)));
  const positive = (assessment.factors || []).filter(x => finiteNumber(x.delta) > 2).sort((a,b)=>b.delta-a.delta);
  const negative = (assessment.factors || []).filter(x => finiteNumber(x.delta) < -2).sort((a,b)=>a.delta-b.delta);
  const reasons = [...positive.slice(0, 3), ...negative.slice(0, 2)]
    .slice(0, 4)
    .map(x => x.label + (x.note ? " · " + x.note : ""));

  return {
    signal,
    confidence,
    score: assessment.score,
    quality,
    horizon: "1-2d",
    thesis: isPosition
      ? (signal === "SELL"
          ? "El score común de ViewInvAI se ha deteriorado hasta zona de salida."
          : signal === "REVIEW"
            ? "La posición requiere revisión porque la convicción o la calidad de los datos no son suficientes."
            : "La posición mantiene una lectura compatible con seguimiento.")
      : (signal === "BUY"
          ? "El score común de ViewInvAI supera el umbral de entrada con calidad de datos suficiente."
          : signal === "AVOID"
            ? "La combinación actual de momentum, tendencia, liquidez y catalizadores es desfavorable."
            : "Todavía no existe confirmación suficiente para una entrada fuerte."),
    riskSummary: negative.length
      ? "Principales riesgos: " + negative.slice(0, 2).map(x => x.label).join(", ") + "."
      : "Persisten riesgos de volatilidad y cambios rápidos de momentum.",
    reasons,
    catalysts: (assessment.catalyst && assessment.catalyst.events || []).slice(0, 4).map(x => x.event && x.event.title).filter(Boolean),
    engine: "viewinvai-score/" + (engine.VERSION || "unknown"),
    model: ""
  };
}

function extractAiJson(result) {
  let text = "";
  if (typeof result === "string") text = result;
  else if (result && typeof result.response === "string") text = result.response;
  else if (result && typeof result.result === "string") text = result.result;
  else if (result && result.response && typeof result.response.response === "string") text = result.response.response;
  else if (result && Array.isArray(result.choices) && result.choices[0]) {
    const c = result.choices[0];
    text = String(c.message && c.message.content || c.text || "");
  }
  else if (result && result.response && typeof result.response === "object") text = JSON.stringify(result.response);
  if (!text) return null;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch (_) { return null; }
}

// Diagnóstico de Workers AI para /api/backend/status: estado en memoria y, con ?probe=ai, una
// llamada mínima cuyo resultado se guarda una hora en KV (como mucho 24 escrituras al día).
async function aiHealthStatus(env, url) {
  const cat = aiCatalogMemo || {};
  const out = { ...aiHealth, catalog: { at: cat.at ? new Date(cat.at).toISOString() : null, source: cat.source || "pending", models: (cat.models || []).slice(0, 5) } };
  if (url.searchParams.get("probe") !== "ai" || !env.AI || typeof env.AI.run !== "function") return out;
  const key = "ai-probe:v1";
  if (env.HOT_STATE_KV) {
    try { const cached = await env.HOT_STATE_KV.get(key, "json"); if (cached) return { ...out, probe: cached, probeCached: true }; } catch (_) {}
  }
  let probe;
  try {
    const run = await runWorkersAi(env, { prompt: 'Responde solo con JSON: {"ok":true}', max_tokens: 12, temperature: 0 });
    probe = { ok: true, model: run.model, at: nowIso(), parsed: !!extractAiJson(run.result) };
  } catch (error) {
    probe = { ok: false, error: trimText(String(error && error.message || error), 240), at: nowIso() };
  }
  if (env.HOT_STATE_KV) { try { await env.HOT_STATE_KV.put(key, JSON.stringify(probe), { expirationTtl: 3600 }); } catch (_) {} }
  return { ...out, probe };
}

async function aiAssessment(env, target, stock, chart, events, fallback) {
  if (!env.AI || typeof env.AI.run !== "function") return fallback;
  let model = configuredAiModel(env);

  const prompt = [
    "You are ViewInvAI, a risk-aware market monitoring assistant.",
    "Use ONLY the supplied structured data. Do not invent facts or news.",
    "Distinguish source verification from market interpretation. An issuer-distributed release is not independent corroboration.",
    "The user may own the stock (position) or only follow it (watchlist).",
    "The deterministicReference is a quantitative baseline, not an instruction. Independently assess whether the supplied evidence supports it.",
    "Use the model for contextual synthesis across price action, liquidity, trend, catalysts, sector exposure and recent verified news.",
    "Do not invent breaking facts, geopolitical events, sentiment or social activity that are absent from the supplied structured data.",
    "For a position, signal must be HOLD, REVIEW, or SELL. For watchlist, signal must be BUY, WATCH, or AVOID.",
    "Return JSON only with keys: signal, confidence, scoreAdjustment, horizon, thesis, riskSummary, reasons (max 4 strings), catalysts (max 4 strings). scoreAdjustment must be between -12 and 12.",
    "",
    JSON.stringify({
      subject: {
        type: target.subject_type,
        quantity: finiteNumber(target.quantity),
        avgPrice: finiteNumber(target.avg_price),
        currency: target.currency || null
      },
      stock: {
        stockKey: target.stock_key,
        ticker: Number(target.prefer_tr) === 1 ? (stock.trTicker || stock.ticker) : stock.ticker,
        name: stock.name,
        exchange: Number(target.prefer_tr) === 1 ? (stock.trExchange || "LSX") : stock.exchange,
        market: Number(target.prefer_tr) === 1 ? "Trade Republic / LSX" : "EEUU",
        currency: Number(target.prefer_tr) === 1 ? "EUR" : "USD",
        price: Number(target.prefer_tr) === 1
          ? (stock.trLivePrice ?? (chart && chart.available ? chart.last : null))
          : (stock.usLivePrice ?? null),
        changePct: Number(target.prefer_tr) === 1
          ? (stock.trLiveChangePct ?? (chart && chart.available ? chart.return20 : null))
          : (stock.usLiveChangePct ?? null),
        bid: Number(target.prefer_tr) === 1 ? (stock.trLiveBid ?? null) : (stock.usLiveBid ?? null),
        ask: Number(target.prefer_tr) === 1 ? (stock.trLiveAsk ?? null) : (stock.usLiveAsk ?? null),
        relVolume: stock.relVolume,
        volume: Number(target.prefer_tr) === 1 ? null : (stock.usLiveVolume ?? null),
        avgVolume: stock.avgVolume,
        rsi: stock.rsi,
        adx: stock.adx,
        ema20: stock.ema20,
        ema50: stock.ema50,
        marketCap: stock.marketCap
      },
      chart,
      recentEvents: events,
      deterministicReference: {
        score: fallback.score,
        signal: fallback.signal,
        confidence: fallback.confidence
      }
    })
  ].join("\n");

  try {
    const run = await runWorkersAi(env, { prompt, max_tokens: 520, temperature: 0.1 }, model);
    const result = run.result; model = run.model;
    const parsed = extractAiJson(result);
    if (!parsed) return fallback;

    const isPosition = target.subject_type === "position";
    const allowed = new Set(isPosition ? ["HOLD","REVIEW","SELL"] : ["BUY","WATCH","AVOID"]);
    let candidate = String(parsed.signal || fallback.signal || "").toUpperCase();
    if (!allowed.has(candidate)) candidate = fallback.signal;
    const adjustment = Math.max(-12, Math.min(12, finiteNumber(parsed.scoreAdjustment) ?? 0));
    const score = Math.max(0, Math.min(100, Math.round((fallback.score + adjustment) * 10) / 10));
    const quality = finiteNumber(fallback.quality) ?? 0;
    if (quality < 55) candidate = isPosition ? "REVIEW" : "WATCH";
    if (!isPosition && candidate === "BUY" && score < 60) candidate = "WATCH";
    if (isPosition && candidate === "SELL" && score > 55) candidate = "REVIEW";
    const aiConfidence = Math.max(0, Math.min(100, finiteNumber(parsed.confidence) ?? fallback.confidence));
    const confidence = Math.round(Math.max(45, Math.min(96, fallback.confidence * 0.45 + aiConfidence * 0.55)));
    return {
      signal: candidate,
      confidence,
      score,
      horizon: trimText(parsed.horizon || fallback.horizon || "1-2d", 24) || "1-2d",
      thesis: trimText(parsed.thesis || fallback.thesis, 500),
      riskSummary: trimText(parsed.riskSummary || fallback.riskSummary, 500),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(x => trimText(x, 180)).filter(Boolean).slice(0, 4) : fallback.reasons,
      catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts.map(x => trimText(x, 180)).filter(Boolean).slice(0, 4) : fallback.catalysts,
      engine: "viewinvai-hybrid/" + (globalThis.ViewInvAIScore && globalThis.ViewInvAIScore.VERSION || "unknown") + "+workers-ai",
      model,
      aiValidated: true
    };
  } catch (error) {
    console.warn("Workers AI analysis failed", String(error && error.message || error));
    return fallback;
  }
}

let globalNotificationSettingsSchemaReady=false;
async function ensureGlobalNotificationSettingsSchema(env){
  if(globalNotificationSettingsSchemaReady)return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS user_notification_settings ("+
    "user_id TEXT PRIMARY KEY,opted_in_explicitly INTEGER NOT NULL DEFAULT 0,notifications_enabled INTEGER NOT NULL DEFAULT 0,news_events_enabled INTEGER NOT NULL DEFAULT 0,pulse_ai_enabled INTEGER NOT NULL DEFAULT 0,radar_enabled INTEGER NOT NULL DEFAULT 0,price_enabled INTEGER NOT NULL DEFAULT 0,portfolio_enabled INTEGER NOT NULL DEFAULT 0,portfolio_goal_enabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,"+
    "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  const columns=await env.DB.prepare("PRAGMA table_info(user_notification_settings)").all();
  const names=new Set((columns.results||[]).map(row=>String(row.name||"")));
  for(const column of ["opted_in_explicitly","notifications_enabled","radar_enabled","price_enabled","portfolio_enabled","portfolio_goal_enabled"]){
    if(names.has(column))continue;
    try{
      await env.DB.prepare("ALTER TABLE user_notification_settings ADD COLUMN "+column+" INTEGER NOT NULL DEFAULT 0").run();
    }catch(error){
      if(!/duplicate column/i.test(String(error&&error.message||error)))throw error;
    }
  }
  // Radar AI tiers (2026-10): one switch per tier. On first migration high/opportunity inherit
  // the old «Cambios en Radar AI»/«Pulso IA» choice; «En vigilancia» starts off.
  let addedTierColumns=false;
  for(const column of ["radar_high_enabled","radar_opportunity_enabled","radar_watch_enabled"]){
    if(names.has(column))continue;
    try{
      await env.DB.prepare("ALTER TABLE user_notification_settings ADD COLUMN "+column+" INTEGER NOT NULL DEFAULT 0").run();
      addedTierColumns=true;
    }catch(error){
      if(!/duplicate column/i.test(String(error&&error.message||error)))throw error;
    }
  }
  // «Catalizadores mañana» (2026-10): on first migration inherits «Noticias y eventos».
  if(!names.has("catalyst_eve_enabled")){
    try{
      await env.DB.prepare("ALTER TABLE user_notification_settings ADD COLUMN catalyst_eve_enabled INTEGER NOT NULL DEFAULT 0").run();
      await env.DB.prepare("UPDATE user_notification_settings SET catalyst_eve_enabled=news_events_enabled").run();
    }catch(error){
      if(!/duplicate column/i.test(String(error&&error.message||error)))throw error;
    }
  }
  if(addedTierColumns){
    await env.DB.prepare("UPDATE user_notification_settings SET radar_high_enabled=CASE WHEN radar_enabled=1 OR pulse_ai_enabled=1 THEN 1 ELSE 0 END,radar_opportunity_enabled=CASE WHEN radar_enabled=1 OR pulse_ai_enabled=1 THEN 1 ELSE 0 END").run();
  }
  globalNotificationSettingsSchemaReady=true;
}

async function globalNotificationSettingsForUser(env,userId){
  await ensureGlobalNotificationSettingsSchema(env);
  const row=await env.DB.prepare(
    "SELECT opted_in_explicitly,notifications_enabled,news_events_enabled,catalyst_eve_enabled,radar_high_enabled,radar_opportunity_enabled,radar_watch_enabled,price_enabled,portfolio_enabled,portfolio_goal_enabled FROM user_notification_settings WHERE user_id=?"
  ).bind(userId).first();
  const optedIn=!!row&&Number(row.opted_in_explicitly)===1;
  const radarHigh=optedIn&&Number(row.radar_high_enabled)===1;
  const radarOpportunity=optedIn&&Number(row.radar_opportunity_enabled)===1;
  const radarWatch=optedIn&&Number(row.radar_watch_enabled)===1;
  const radar=radarHigh||radarOpportunity||radarWatch;
  return {
    enabled: optedIn&&Number(row.notifications_enabled)===1,
    newsEvents: optedIn&&Number(row.news_events_enabled)===1,
    catalystEve: optedIn&&Number(row.catalyst_eve_enabled)===1,
    radarAi: radar,
    pulseAi: false,
    radar,radarHigh,radarOpportunity,radarWatch,
    price: optedIn&&Number(row.price_enabled)===1,
    portfolio: optedIn&&Number(row.portfolio_enabled)===1,
    portfolioGoal: optedIn&&Number(row.portfolio_goal_enabled)===1
  };
}

async function notificationPreferenceForTarget(env,target){
  await ensureNotificationPreferenceSchema(env);
  const userId=trimText(target&&target.user_id,128);
  const stockKey=trimText(target&&target.stock_key,120).toUpperCase();
  if(!userId||!stockKey)return null;
  return env.DB.prepare(
    "SELECT news_enabled,pulse_enabled,radar_enabled,price_up_enabled,price_down_enabled FROM notification_preferences WHERE user_id=? AND stock_key=? AND prefer_tr=? LIMIT 1"
  ).bind(userId,stockKey,Number(target&&target.prefer_tr)===1?1:0).first();
}

function notificationPreferenceAllows(preference,column,defaultValue=false){
  return preference ? Number(preference[column])===1 : !!defaultValue;
}

async function analysisSettingsForUser(env, userId) {
  const row = await env.DB.prepare(
    "SELECT analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change FROM user_settings WHERE user_id=?"
  ).bind(userId).first();
  return {
    positionsMinutes: Math.max(5, Math.min(240, Math.round(finiteNumber(row && row.analysis_positions_minutes) ?? 10))),
    watchlistMinutes: Math.max(10, Math.min(1440, Math.round(finiteNumber(row && row.analysis_watchlist_minutes) ?? 30))),
    minBuyConfidence: Math.max(60, Math.min(99, Math.round(finiteNumber(row && row.min_buy_confidence) ?? 85))),
    minSellConfidence: Math.max(60, Math.min(99, Math.round(finiteNumber(row && row.min_sell_confidence) ?? 80))),
    notifyScoreChange: Math.max(5, Math.min(60, Math.round(finiteNumber(row && row.notify_score_change) ?? 20)))
  };
}

async function maybeCreateNewsAlerts(env, target, stock, events, snapshotId) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates = (events || [])
    .filter(event => {
      const when = new Date(event && event.date || 0).getTime();
      const impact = finiteNumber(event && event.impactScore) ?? 0;
      return event && event.eventKind === "news" && Number.isFinite(when) && when >= cutoff && impact >= 60;
    })
    .sort((a,b) => (finiteNumber(b.impactScore) ?? 0) - (finiteNumber(a.impactScore) ?? 0) || new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 3);

  const created = [];
  for (const event of candidates) {
    const message = trimText(event.title || event.fact || "Noticia relacionada con el valor.", 500);
    if (!message) continue;
    const duplicate = await env.DB.prepare(
      "SELECT id FROM alert_events WHERE user_id=? AND stock_key=? AND alert_type='stock-news' AND message=? LIMIT 1"
    ).bind(target.user_id, target.stock_key, message).first();
    if (duplicate) continue;

    const impact = finiteNumber(event.impactScore) ?? 0;
    const severity = impact >= 85 ? "high" : impact >= 70 ? "warning" : "info";
    const id = uid("al_");
    const source = trimText(event.source || event.verification || "", 120);
    const title = (event.official ? "Fuente oficial · " : "Noticia · ") + target.ticker;
    const body = source ? message + " · " + source : message;
    const now = nowIso();

    await env.DB.prepare(
      "INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,snapshot_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      id, target.user_id, target.stock_key, target.ticker, stock.name || target.name || "",
      "stock-news", severity, title, body, snapshotId || null, now
    ).run();

    const alert = { id, alert_type: "stock-news", severity, title, message: body };
    try { await dispatchPushAlert(env, alert, target); }
    catch (error) { console.warn("News push dispatch failed", String(error && error.message || error)); }
    created.push(id);
  }
  return created;
}

async function maybeCreateEventAlerts(env,target,stock,events,snapshotId){
  const nowMs=Date.now(),horizon=nowMs+7*24*60*60*1000;
  const candidates=(events||[])
    .filter(event=>{
      const when=new Date(event&&event.date||0).getTime();
      const impact=finiteNumber(event&&event.impactScore)??50;
      return event&&event.eventKind!=="news"&&Number.isFinite(when)&&when>=nowMs-2*60*60*1000&&when<=horizon&&impact>=50;
    })
    .sort((a,b)=>new Date(a.date||0)-new Date(b.date||0)||(finiteNumber(b.impactScore)??50)-(finiteNumber(a.impactScore)??50))
    .slice(0,3);
  const created=[];
  for(const event of candidates){
    const message=trimText(event.title||event.fact||"Evento próximo relacionado con el valor.",500);
    if(!message)continue;
    const dateText=new Date(event.date).toISOString().slice(0,10);
    const bodyBase=dateText+" · "+message;
    const source=trimText(event.source||event.verification||"",120);
    const body=source?bodyBase+" · "+source:bodyBase;
    const duplicate=await env.DB.prepare(
      "SELECT id FROM alert_events WHERE user_id=? AND stock_key=? AND alert_type='stock-event' AND message=? LIMIT 1"
    ).bind(target.user_id,target.stock_key,body).first();
    if(duplicate)continue;
    const impact=finiteNumber(event.impactScore)??50;
    const severity=impact>=85?"high":impact>=65?"warning":"info";
    const id=uid("al_"),title=(event.official?"Evento oficial · ":"Evento · ")+target.ticker,now=nowIso();
    await env.DB.prepare(
      "INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,snapshot_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(id,target.user_id,target.stock_key,target.ticker,stock.name||target.name||"","stock-event",severity,title,body,snapshotId||null,now).run();
    const alert={id,alert_type:"stock-event",severity,title,message:body};
    try{await dispatchPushAlert(env,alert,target)}
    catch(error){console.warn("Event push dispatch failed",String(error&&error.message||error))}
    created.push(id);
  }
  return created;
}


// ---------------------------------------------------------------------------
// Decisiones ante avisos de venta («¿vendo en pérdidas o mantengo?»).
// Los avisos position-sell/review/deterioration/recovered quedan pendientes hasta que el
// usuario decide. Con «mantener» se dejan de enviar avisos de venta y se pasa a vigilar
// la recuperación: vuelta al precio de compra, oportunidad de promediar y caídas adicionales.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Ficha de evento: próximo catalizador de una acción con su probabilidad histórica, el contexto de
// fuentes oficiales (SEC, ClinicalTrials.gov, FDA), búsqueda web gratuita (Tavily, 1.000 créditos al
// mes) y un resumen de Workers AI. Datos públicos: se cachean en la base de cachés (Turso o D1) por
// evento y solo se recalculan si cambia el evento, caduca o el usuario pide repetir.
// ---------------------------------------------------------------------------
const EVENT_BASE_RATES={
  pdufa:{pct:90,label:"Aprobación de la FDA en la fecha PDUFA (solicitudes NDA/BLA)",source:"BIO/Informa/QLS, Clinical Development Success Rates 2011-2020"},
  phase3:{pct:58,label:"Éxito de un ensayo de fase 3 (lectura de resultados)",source:"BIO/Informa/QLS, Clinical Development Success Rates 2011-2020"},
  phase2:{pct:29,label:"Éxito de un ensayo de fase 2 (lectura de resultados)",source:"BIO/Informa/QLS, Clinical Development Success Rates 2011-2020"},
  phase1:{pct:52,label:"Paso de fase 1 a fase 2",source:"BIO/Informa/QLS, Clinical Development Success Rates 2011-2020"},
  earnings:{pct:75,label:"Empresas del S&P 500 que baten la previsión de beneficio por acción",source:"FactSet Earnings Insight (media de 5-10 años)"}
};
const EVENT_INSIGHT_TTL_MS=3*24*3600e3,TAVILY_MONTHLY_BUDGET=900;
function eventInsightKind(ev){
  const t=(String(ev&&ev.title||"")+" "+String(ev&&ev.fact||"")+" "+String(ev&&ev.type||"")).toLowerCase();
  // Un registro de ClinicalTrials.gov con fecha de finalización NO es una lectura de resultados:
  // no lleva tasa de éxito (los datos suelen publicarse semanas o meses después).
  if(String(ev&&ev.sourceFamily||"")==="clinicaltrials"||/clinicaltrials\.gov.*finalizaci/.test(t))return "trial-completion";
  if(/\bpdufa\b|\bnda\b|\bbla\b|fda (approval|decision)|decisi[oó]n de la fda/.test(t))return "pdufa";
  const readout=/topline|resultados|results|readout|datos/.test(t);
  if(readout&&/fase 3|phase 3|phase iii|fase iii/.test(t))return "phase3";
  if(readout&&/fase 2|phase 2|phase ii\b|fase ii\b/.test(t))return "phase2";
  if(String(ev&&ev.type||"")==="earnings"||/earnings|resultados trimestrales|publicaci[oó]n de resultados/.test(t))return "earnings";
  return "other";
}
const sameInstrumentEvent=(e,stock)=>{
  if(String(e&&e.ticker||"").toUpperCase()!==String(stock.ticker||"").toUpperCase())return false;
  const isin=String(stock.isin||stock.usIsin||stock.trIsin||"").toUpperCase(),eIsin=String(e.isin||"").toUpperCase();
  if(isin&&eIsin)return isin===eIsin;
  const ex=String(stock.exchange||"").toUpperCase(),eEx=String(e.exchange||"").toUpperCase();
  return !ex||!eEx||ex===eEx;
};
const eventDay=e=>String(e&&e.date||"").slice(0,10);
async function nextStockEvent(snapshot,stock,services,withLive){
  const today=nowIso().slice(0,10),limit=new Date(Date.now()+60*86400e3).toISOString().slice(0,10);
  let list=(Array.isArray(snapshot&&snapshot.events)?snapshot.events:[]).filter(e=>sameInstrumentEvent(e,stock));
  if(withLive&&services.loadOfficialEvents){try{list=list.concat((await services.loadOfficialEvents(stock,{ticker:stock.ticker,stock_key:goalServerKey(stock)})||[]).map(e=>({...e,ticker:e.ticker||stock.ticker})))}catch(_){}}
  const seen=new Set();
  list=list.filter(e=>{const k=e.id||(eventDay(e)+"|"+e.title);if(seen.has(k))return false;seen.add(k);return true});
  // Eventos con solo fecha (sin hora) siguen vigentes todo su día.
  const future=list.filter(e=>e&&e.eventKind!=="news"&&eventDay(e)>=today&&eventDay(e)<=limit)
    .sort((a,b)=>eventDay(a).localeCompare(eventDay(b))||(finiteNumber(b.impactScore)||0)-(finiteNumber(a.impactScore)||0));
  // Contexto: los próximos eventos más las notas oficiales recientes (SEC, FDA) de los últimos 60 días.
  const since=new Date(Date.now()-60*86400e3).toISOString().slice(0,10);
  const recentOfficial=list.filter(e=>e&&e.eventKind==="news"&&e.official&&eventDay(e)>=since).sort((a,b)=>eventDay(b).localeCompare(eventDay(a)));
  return{next:future[0]||null,related:[...future.slice(0,4),...recentOfficial.slice(0,4)]};
}
function eventFingerprint(ev){
  const raw=String(ev.id||"")||(eventDay(ev)+"|"+String(ev.title||""));
  let h=0;for(let i=0;i<raw.length;i++)h=(h*31+raw.charCodeAt(i))|0;
  return eventDay(ev)+":"+(h>>>0).toString(36);
}
const eventDateLabel=ev=>String(ev.datePrecision||"")==="month"?String(ev.date||"").slice(0,7)+" (solo se conoce el mes)":eventDay(ev);
async function tavilyBudgetOk(env){
  if(!env.HOT_STATE_KV)return true;
  const key="tavily-used:"+nowIso().slice(0,7);
  try{const used=Number(await env.HOT_STATE_KV.get(key))||0;if(used>=TAVILY_MONTHLY_BUDGET)return false;await env.HOT_STATE_KV.put(key,String(used+1),{expirationTtl:40*86400});return true}catch(_){return true}
}
async function tavilySearch(env,query){
  const keyValue=String(env.TAVILY_API_KEY||"").trim();
  if(!keyValue)return{ok:false,reason:"not-configured",results:[]};
  if(!await tavilyBudgetOk(env))return{ok:false,reason:"monthly-budget",results:[]};
  try{
    const res=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+keyValue},
      body:JSON.stringify({query:trimText(query,380),search_depth:"basic",max_results:6,include_answer:false,topic:"news",days:120})});
    if(!res.ok)return{ok:false,reason:"http-"+res.status,results:[]};
    const data=await res.json();
    return{ok:true,results:(data.results||[]).slice(0,6).map(r=>({title:trimText(r.title,160),url:String(r.url||"").slice(0,400),content:trimText(r.content,700),date:r.published_date||""}))};
  }catch(error){return{ok:false,reason:trimText(String(error&&error.message||error),120),results:[]}}
}
async function ensureEventInsightSchema(db){
  await ensureCacheSchema(db,"event_insights",["CREATE TABLE IF NOT EXISTS event_insights (cache_key TEXT PRIMARY KEY,stock_key TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_event_insights_stock ON event_insights(stock_key,created_at)"]);
}
const optionalNumber=v=>v===null||v===undefined||v===""?null:finiteNumber(v);
async function buildEventInsight(env,stock,ev,related){
  const kind=eventInsightKind(ev),base=EVENT_BASE_RATES[kind]||null,name=String(stock.name||stock.ticker||"");
  const query=name+" "+(stock.ticker||"")+" "+(kind==="pdufa"?"PDUFA FDA decision":kind==="trial-completion"?"clinical trial topline data timing":kind.startsWith("phase")?"clinical trial results":kind==="earnings"?"earnings expectations":"")+" "+String(ev.date||"").slice(0,7);
  const web=await searchRoute(env,query);
  const official=(related||[]).map(e=>"- "+eventDay(e)+" · "+trimText(e.title,140)+" · "+trimText(e.fact||"",260)+" ("+(e.source||"")+")").join("\n");
  const news=(web.results||[]).map((r,i)=>"["+(i+1)+"] "+r.title+" ("+(r.date||"s/f")+")\n"+r.content).join("\n\n");
  let ai=null,model="";
  {
    const prompt=["Eres un analista de biotecnología y mercados. Analiza el próximo evento de una acción con los datos aportados.",
      "Acción: "+name+" ("+(stock.ticker||"")+", "+(stock.exchange||"")+"), sector "+(stock.sector||"")+", capitalización "+(finiteNumber(stock.marketCap)?Math.round(stock.marketCap/1e6)+" M$":"desconocida")+".",
      "Evento: "+(ev.title||"")+" · fecha "+eventDateLabel(ev)+" · fuente "+(ev.source||"")+".",
      kind==="trial-completion"?"Atención: es la fecha de finalización registrada de un ensayo, no una publicación de resultados. Indica si hay fecha anunciada para los datos.":"",
      base?"Probabilidad histórica de este tipo de evento: "+base.pct+" % ("+base.label+").":"No hay probabilidad histórica aplicable a este evento: no inventes una.",
      "Eventos y notas oficiales relacionadas:\n"+(official||"(ninguno)"),
      "Noticias recientes (búsqueda web):\n"+(news||"(sin resultados)"),
      "Responde SOLO con JSON en español: {\"confirmedDate\":\"AAAA-MM-DD o null\",\"summary\":\"2-3 frases\",\"probabilityPct\":número 0-100 o null,\"probabilityReason\":\"1 frase\",\"factorsFor\":[\"...\"],\"factorsAgainst\":[\"...\"],\"expectedMovePct\":número o null,\"marketExpectation\":\"qué descuenta el precio\",\"sources\":[números de noticia usadas]}.",
      "Parte de la probabilidad histórica y ajústala solo con hechos concretos de los datos. No inventes datos: si algo no aparece, usa null."].filter(Boolean).join("\n\n");
    try{
      const run=await aiRoute(env,{prompt,maxTokens:900,json:true});
      ai=extractAiJson(run.text);model=run.provider+" · "+run.model;
    }catch(error){console.warn("Event insight AI failed",String(error&&error.message||error))}
  }
  const clampPct=v=>{const n=optionalNumber(v);return n===null?null:Math.max(0,Math.min(100,Math.round(n)))};
  const usedIdx=Array.isArray(ai&&ai.sources)?ai.sources.map(Number).filter(n=>n>=1&&n<=(web.results||[]).length):[];
  const sources=[...(related||[]).filter(e=>e.url).slice(0,5).map(e=>({title:trimText(e.title,140),url:e.url,official:!!e.official||/sec|fda|clinicaltrials/i.test(String(e.source||""))})),
    ...(web.results||[]).filter((r,i)=>!usedIdx.length||usedIdx.includes(i+1)).slice(0,5).map(r=>({title:r.title,url:r.url,official:false}))];
  const list=v=>Array.isArray(v)?v.map(x=>trimText(String(x),220)).filter(Boolean).slice(0,5):[];
  return{
    stockKey:goalServerKey(stock),ticker:stock.ticker||"",name,
    event:{id:ev.id||"",date:ev.date,datePrecision:ev.datePrecision||"day",title:trimText(ev.title,200),type:ev.type||"",kind,source:ev.source||"",url:ev.url||""},
    baseRate:base,
    ai:ai?{confirmedDate:/^\d{4}-\d{2}-\d{2}$/.test(String(ai.confirmedDate||""))?ai.confirmedDate:null,summary:trimText(ai.summary,600),
      probabilityPct:clampPct(ai.probabilityPct),probabilityReason:trimText(ai.probabilityReason,300),factorsFor:list(ai.factorsFor),factorsAgainst:list(ai.factorsAgainst),
      expectedMovePct:optionalNumber(ai.expectedMovePct),marketExpectation:trimText(ai.marketExpectation,300),model}:null,
    web:{ok:!!web.ok,provider:web.provider||"",reason:web.ok?"":web.reason||""},
    sources,generatedAt:nowIso()
  };
}
async function handleEventInsight(request,env,user,json,url,services){
  if(request.method!=="GET")return json({error:"Method not allowed"},405);
  // Prueba de la búsqueda web (solo con sesión iniciada): consulta mínima, guardada 1 hora.
  if(url.searchParams.get("probe")==="tavily")return json({webSearch:await tavilyStatus(env,true)});
  const stockKey=trimText(url.searchParams.get("stockKey")||"",80).toUpperCase(),cacheOnly=url.searchParams.get("cacheOnly")==="1",refresh=url.searchParams.get("refresh")==="1";
  if(!stockKey||!services.loadMarketSnapshot)return json({error:"Falta la acción."},400);
  const today=nowIso().slice(0,10);
  const readCache=sql=>withCacheDb(env,async db=>{await ensureEventInsightSchema(db);return db.prepare(sql.q).bind(...sql.b).first()}).catch(()=>null);
  const usable=row=>{if(!row)return null;try{const p=JSON.parse(row.payload);const ttl=Date.parse(p.event.date)-Date.now()<=3*86400e3?24*3600e3:EVENT_INSIGHT_TTL_MS;
    return eventDay(p.event)>=today&&Date.now()-Date.parse(row.created_at)<ttl?{...p,cached:true}:null}catch(_){return null}};
  // Al abrir la ficha solo se lee lo ya analizado (sin llamadas a fuentes externas).
  if(cacheOnly){
    const hit=usable(await readCache({q:"SELECT payload,created_at FROM event_insights WHERE stock_key=? ORDER BY created_at DESC LIMIT 1",b:[stockKey]}));
    if(hit)return json({insight:hit});
    const snapshot=await services.loadMarketSnapshot(env),stock=findStock(snapshot,{stock_key:stockKey});
    if(!stock)return json({insight:null});
    const{next}=await nextStockEvent(snapshot,stock,services,false);
    if(!next)return json({insight:null,reason:"Sin evento con fecha en los próximos 60 días."});
    const kind=eventInsightKind(next);
    return json({insight:null,event:{date:next.date,datePrecision:next.datePrecision||"day",title:next.title,kind},baseRate:EVENT_BASE_RATES[kind]||null});
  }
  const snapshot=await services.loadMarketSnapshot(env),stock=findStock(snapshot,{stock_key:stockKey});
  if(!stock)return json({error:"Acción no encontrada."},404);
  const{next,related}=await nextStockEvent(snapshot,stock,services,true);
  if(!next)return json({insight:null,reason:"Sin evento con fecha en los próximos 60 días."});
  const cacheKey="ev2:"+goalServerKey(stock)+":"+eventFingerprint(next);
  if(!refresh){const hit=usable(await readCache({q:"SELECT payload,created_at FROM event_insights WHERE cache_key=?",b:[cacheKey]}));if(hit)return json({insight:hit})}
  // Límite por usuario: 12 análisis nuevos al día (cada uno puede gastar 1 búsqueda web).
  if(env.HOT_STATE_KV){
    const k="ev-quota:"+user.id+":"+today;
    try{const used=Number(await env.HOT_STATE_KV.get(k))||0;if(used>=12)return json({error:"Has llegado al máximo de 12 análisis de eventos por hoy."},429);await env.HOT_STATE_KV.put(k,String(used+1),{expirationTtl:2*86400})}catch(_){}
  }
  const insight=await buildEventInsight(env,stock,next,related);
  await withCacheDb(env,async db=>{await ensureEventInsightSchema(db);
    return db.prepare("INSERT INTO event_insights (cache_key,stock_key,payload,created_at) VALUES (?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at")
      .bind(cacheKey,insight.stockKey,JSON.stringify(insight),insight.generatedAt).run()}).catch(()=>{});
  return json({insight});
}
// Estado de la búsqueda web. La consulta de prueba solo se hace desde una ruta con sesión iniciada.
async function tavilyStatus(env,runProbe=false){
  const out={configured:!!String(env.TAVILY_API_KEY||"").trim()};
  if(!runProbe||!out.configured)return out;
  if(env.HOT_STATE_KV){try{const c=await env.HOT_STATE_KV.get("tavily-probe:v1","json");if(c)return{...out,probe:c,probeCached:true}}catch(_){}}
  const r=await tavilySearch(env,"FDA PDUFA date this month");
  const probe={ok:!!r.ok,results:(r.results||[]).length,reason:r.ok?"":r.reason,at:nowIso()};
  if(env.HOT_STATE_KV){try{await env.HOT_STATE_KV.put("tavily-probe:v1",JSON.stringify(probe),{expirationTtl:3600})}catch(_){}}
  return{...out,probe};
}

// ---------------------------------------------------------------------------
// Proveedores externos gratuitos: inventario, contadores de uso y reparto con respaldo automático.
// Cada tarea prueba los proveedores por orden; si uno no tiene clave, agota su cupo o falla,
// se pasa al siguiente. Las claves viven solo como secretos de Cloudflare (nunca se devuelven).
// ---------------------------------------------------------------------------
const PROVIDERS=[
  {id:"gemini",label:"Google Gemini",kind:"IA",secret:"GEMINI_API_KEY",free:"Flash/Flash-Lite: cientos a ~1.500 consultas/día según modelo",dashboard:"https://aistudio.google.com/usage"},
  {id:"groq",label:"Groq",kind:"IA",secret:"GROQ_API_KEY",free:"~1.000 consultas/día",dashboard:"https://console.groq.com/settings/limits"},
  {id:"openrouter",label:"OpenRouter (modelos free)",kind:"IA",secret:"OPENROUTER_API_KEY",free:"50 consultas/día en modelos :free",dashboard:"https://openrouter.ai/settings/keys"},
  {id:"workersai",label:"Cloudflare Workers AI",kind:"IA",secret:"",free:"10.000 neuronas/día",dashboard:"https://dash.cloudflare.com/?to=/:account/ai/workers-ai"},
  {id:"tavily",label:"Tavily",kind:"Búsqueda",secret:"TAVILY_API_KEY",free:"1.000 créditos/mes",dashboard:"https://app.tavily.com/home",monthlyLimit:1000},
  {id:"exa",label:"Exa",kind:"Búsqueda",secret:"EXA_API_KEY",free:"10 $ de crédito/mes (~2.500 búsquedas)",dashboard:"https://dashboard.exa.ai/usage"},
  {id:"langsearch",label:"LangSearch",kind:"Búsqueda",secret:"LANGSEARCH_API_KEY",free:"Cupo diario gratuito",dashboard:"https://langsearch.com/dashboard"},
  {id:"jina",label:"Jina (lector y búsqueda)",kind:"Lectura web",secret:"JINA_API_KEY",free:"10 M de tokens al registrarse",dashboard:"https://jina.ai/api-dashboard"},
  {id:"finnhub",label:"Finnhub",kind:"Datos de mercado",secret:"FINNHUB_API_KEY",free:"60 consultas/minuto",dashboard:"https://finnhub.io/dashboard"}
];
const providerKey=(env,p)=>p.secret?String(env[p.secret]||"").trim():"";
const providerCooldown=new Map();
const providerReady=(env,id)=>{const p=PROVIDERS.find(x=>x.id===id);return !!p&&(!p.secret||!!providerKey(env,p))&&!((providerCooldown.get(id)||0)>Date.now())};
function providerFail(id,status){if(status===429||status===402||status===432||status>=500)providerCooldown.set(id,Date.now()+(status===429||status===432||status===402?30:5)*60e3)}
async function ensureProviderUsageSchema(db){
  await ensureCacheSchema(db,"provider_usage",["CREATE TABLE IF NOT EXISTS provider_usage (provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_at TEXT,last_error TEXT,PRIMARY KEY(provider,period))"]);
}
async function recordProviderUse(env,id,ok,error=""){
  if(ok)providerCooldown.delete(id);
  const now=nowIso(),periods=["d:"+now.slice(0,10),"m:"+now.slice(0,7)];
  try{await withCacheDb(env,async db=>{await ensureProviderUsageSchema(db);
    return db.batch(periods.map(period=>db.prepare("INSERT INTO provider_usage (provider,period,calls,errors,last_at,last_error) VALUES (?,?,1,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,errors=errors+excluded.errors,last_at=excluded.last_at,last_error=CASE WHEN excluded.errors>0 THEN excluded.last_error ELSE last_error END")
      .bind(id,period,ok?0:1,now,ok?null:trimText(error,200))))})}catch(_){}
}
async function providerFetch(id,url,init,timeoutMs=20000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...init,signal:controller.signal})}finally{clearTimeout(timer)}
}
// --- IA: Gemini → Groq → OpenRouter → Workers AI ---------------------------------------------
const GROQ_MODELS=["openai/gpt-oss-120b","qwen/qwen3-32b","openai/gpt-oss-20b"];
let openRouterFreeMemo={at:0,models:[]};
async function openRouterFreeModels(key){
  if(Date.now()-openRouterFreeMemo.at<6*3600e3&&openRouterFreeMemo.models.length)return openRouterFreeMemo.models;
  try{const r=await providerFetch("openrouter","https://openrouter.ai/api/v1/models",{headers:{"Authorization":"Bearer "+key}},12000);const d=await r.json();
    const ids=(d.data||[]).map(m=>String(m.id||"")).filter(id=>id.endsWith(":free"));
    const rank=id=>/llama-3\.3-70b|gpt-oss-120b|qwen3|deepseek/.test(id)?0:1;
    openRouterFreeMemo={at:Date.now(),models:ids.sort((a,b)=>rank(a)-rank(b)).slice(0,4)}}catch(_){}
  return openRouterFreeMemo.models;
}
async function openAiCompatible(id,url,key,model,prompt,maxTokens){
  const r=await providerFetch(id,url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
    body:JSON.stringify({model,messages:[{role:"user",content:prompt}],max_tokens:maxTokens,temperature:0.2})},45000);
  if(!r.ok){const e=new Error(id+" HTTP "+r.status);e.status=r.status;throw e}
  const d=await r.json();const text=String(d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content||"");
  if(!text)throw new Error(id+": respuesta vacía");
  return text;
}
async function aiRoute(env,{prompt,maxTokens=900,json=true}){
  const tried=[];
  if(providerReady(env,"gemini")){
    try{
      const key=providerKey(env,PROVIDERS[0]),chain=await aiGeminiModelChain(key,"");
      for(const model of (chain.models||[]).slice(0,3)){
        const r=await providerFetch("gemini","https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",
          headers:{"Content-Type":"application/json","x-goog-api-key":key},
          body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens,temperature:0.2,...(json?{responseMimeType:"application/json"}:{})}})},45000);
        if(!r.ok){tried.push("gemini:"+model+":"+r.status);providerFail("gemini",r.status);await recordProviderUse(env,"gemini",false,"HTTP "+r.status);if(r.status===429||r.status>=500)continue;break}
        const d=await r.json();const text=((d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts)||[]).map(p=>p.text||"").join("");
        if(text){await recordProviderUse(env,"gemini",true);return{text,provider:"gemini",model}}
        await recordProviderUse(env,"gemini",false,"respuesta vacía");
      }
    }catch(error){tried.push("gemini:"+String(error&&error.message||error));await recordProviderUse(env,"gemini",false,String(error&&error.message||error))}
  }
  if(providerReady(env,"groq")){
    for(const model of GROQ_MODELS){
      try{const text=await openAiCompatible("groq","https://api.groq.com/openai/v1/chat/completions",providerKey(env,PROVIDERS[1]),model,prompt,maxTokens);
        await recordProviderUse(env,"groq",true);return{text,provider:"groq",model}}
      catch(error){tried.push("groq:"+model+":"+(error.status||error.message));providerFail("groq",error.status||0);await recordProviderUse(env,"groq",false,String(error.message||error));if(error.status===429)break}
    }
  }
  if(providerReady(env,"openrouter")){
    for(const model of await openRouterFreeModels(providerKey(env,PROVIDERS[2]))){
      try{const text=await openAiCompatible("openrouter","https://openrouter.ai/api/v1/chat/completions",providerKey(env,PROVIDERS[2]),model,prompt,maxTokens);
        await recordProviderUse(env,"openrouter",true);return{text,provider:"openrouter",model}}
      catch(error){tried.push("openrouter:"+model+":"+(error.status||error.message));providerFail("openrouter",error.status||0);await recordProviderUse(env,"openrouter",false,String(error.message||error));if(error.status===429)break}
    }
  }
  if(env.AI&&typeof env.AI.run==="function"){
    try{const run=await runWorkersAi(env,{messages:[{role:"user",content:prompt}],max_tokens:maxTokens,temperature:0.2},"@cf/meta/llama-3.3-70b-instruct-fp8-fast");
      const r=run.result,text=typeof r==="string"?r:r&&typeof r.response==="string"?r.response:r&&r.response?JSON.stringify(r.response):r&&r.choices?String(r.choices[0].message&&r.choices[0].message.content||""):"";
      await recordProviderUse(env,"workersai",true);return{text,provider:"workersai",model:run.model}}
    catch(error){tried.push("workersai:"+String(error&&error.message||error));await recordProviderUse(env,"workersai",false,String(error&&error.message||error))}
  }
  const e=new Error("Ninguna IA disponible ("+tried.join(" · ")+")");e.tried=tried;throw e;
}
// --- Búsqueda web: Tavily → Exa → LangSearch → Jina --------------------------------------------
async function searchRoute(env,query){
  const tried=[];
  if(providerReady(env,"tavily")){
    const t=await tavilySearch(env,query);
    await recordProviderUse(env,"tavily",t.ok,t.reason||"");
    if(t.ok&&t.results.length)return{ok:true,provider:"tavily",results:t.results};
    tried.push("tavily:"+(t.reason||"0"));if(/http-(429|432)|monthly/.test(t.reason||""))providerCooldown.set("tavily",Date.now()+6*3600e3);else{const st=Number((String(t.reason||"").match(/^http-(\d+)/)||[])[1])||0;providerFail("tavily",st)}
  }
  const attempt=async(id,fn)=>{
    if(!providerReady(env,id))return null;
    try{const results=await fn(providerKey(env,PROVIDERS.find(p=>p.id===id)));await recordProviderUse(env,id,true);if(results.length)return{ok:true,provider:id,results};tried.push(id+":0")}
    catch(error){tried.push(id+":"+(error.status||error.message));providerFail(id,error.status||0);await recordProviderUse(env,id,false,String(error.message||error))}
    return null;
  };
  const fail=(id,r)=>{const e=new Error(id+" HTTP "+r.status);e.status=r.status;return e};
  const clean=v=>trimText(String(v||"").replace(/\s+/g," "),700);
  const order=[
    ["exa",async key=>{const r=await providerFetch("exa","https://api.exa.ai/search",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":key},
      body:JSON.stringify({query:trimText(query,380),numResults:6,contents:{text:{maxCharacters:700}}})});if(!r.ok)throw fail("exa",r);const d=await r.json();
      return (d.results||[]).map(x=>({title:trimText(x.title,160),url:String(x.url||""),content:clean(x.text||x.summary),date:x.publishedDate||""}))}],
    ["langsearch",async key=>{const r=await providerFetch("langsearch","https://api.langsearch.com/v1/web-search",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({query:trimText(query,380),count:6,summary:true,freshness:"oneYear"})});if(!r.ok)throw fail("langsearch",r);const d=await r.json();
      const vals=(d.data&&d.data.webPages&&d.data.webPages.value)||[];return vals.map(x=>({title:trimText(x.name,160),url:String(x.url||""),content:clean(x.summary||x.snippet),date:x.datePublished||""}))}],
    ["jina",async key=>{const r=await providerFetch("jina","https://s.jina.ai/?q="+encodeURIComponent(trimText(query,300)),{headers:{"Authorization":"Bearer "+key,"Accept":"application/json","X-Respond-With":"no-content"}});
      if(!r.ok)throw fail("jina",r);const d=await r.json();return (d.data||[]).slice(0,6).map(x=>({title:trimText(x.title,160),url:String(x.url||""),content:clean(x.description||x.content),date:x.date||""}))}]
  ];
  for(const [id,fn] of order){const out=await attempt(id,fn);if(out)return out}
  return{ok:false,provider:"",reason:tried.join(" · ")||"not-configured",results:[]};
}
// --- Administración: inventario, uso y pruebas -------------------------------------------------
async function isAdminUser(env,user){
  const list=String(env.ADMIN_EMAILS||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(list.length)return list.includes(String(user.email||"").toLowerCase());
  try{const first=await env.DB.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").first();return !!first&&first.id===user.id}catch(_){return false}
}
async function providerProbe(env,p){
  const key=providerKey(env,p);
  const res=async(url,init={})=>{const r=await providerFetch(p.id,url,init,12000);return r};
  try{
    let r,detail="";
    if(p.id==="gemini")r=await res("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",{headers:{"x-goog-api-key":key}});
    else if(p.id==="groq")r=await res("https://api.groq.com/openai/v1/models",{headers:{"Authorization":"Bearer "+key}});
    else if(p.id==="openrouter"){r=await res("https://openrouter.ai/api/v1/key",{headers:{"Authorization":"Bearer "+key}});
      if(r.ok){const d=await r.json();const x=d.data||{};detail="uso "+(finiteNumber(x.usage)??0)+(x.is_free_tier?" · plan gratuito":"");return{ok:true,status:200,detail}}}
    else if(p.id==="tavily"){r=await res("https://api.tavily.com/usage",{headers:{"Authorization":"Bearer "+key}});
      if(r.ok){const d=await r.json().catch(()=>({}));const k=d.key||d.account||d;const used=finiteNumber(k.usage??k.plan_usage),limit=finiteNumber(k.limit??k.plan_limit);
        return{ok:true,status:200,detail:used!==null?"créditos usados "+used+(limit!==null?" de "+limit:""):"conectado",used,limit}}}
    else if(p.id==="exa"){r=await res("https://api.exa.ai/search",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":key},body:JSON.stringify({query:"FDA",numResults:1})})}
    else if(p.id==="langsearch"){r=await res("https://api.langsearch.com/v1/web-search",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},body:JSON.stringify({query:"FDA",count:1})})}
    else if(p.id==="jina"){r=await res("https://r.jina.ai/https://example.com",{headers:{"Authorization":"Bearer "+key,"Accept":"application/json"}})}
    else if(p.id==="finnhub"){r=await res("https://finnhub.io/api/v1/quote?symbol=AAPL&token="+encodeURIComponent(key))}
    else if(p.id==="workersai"){const a=await aiHealthStatus(env,new URL("https://x/?probe=ai"));return{ok:!!(a.probe&&a.probe.ok),status:a.probe&&a.probe.ok?200:0,detail:a.probe&&a.probe.model||a.lastError||""}}
    if(!r)return{ok:false,status:0,detail:"sin prueba"};
    return{ok:r.ok,status:r.status,detail:r.ok?"conectado":r.status===401||r.status===403?"clave rechazada":"HTTP "+r.status};
  }catch(error){return{ok:false,status:0,detail:trimText(String(error&&error.message||error),120)}}
}
async function cloudflareUsage(env){
  const token=String(env.CF_ANALYTICS_TOKEN||"").trim(),account=String(env.CF_ACCOUNT_ID||"").trim();
  if(!token||!account)return{configured:false};
  const since=nowIso().slice(0,10),sinceTime=since+"T00:00:00Z";
  const query="query($a:string!,$d:Date!,$t:Time!){viewer{accounts(filter:{accountTag:$a}){"+
    "workers:workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$t}){sum{requests errors subrequests}dimensions{scriptName}}"+
    "d1:d1AnalyticsAdaptiveGroups(limit:100,filter:{date_geq:$d}){sum{readQueries writeQueries rowsRead rowsWritten}}}}}";
  try{
    const r=await providerFetch("cloudflare","https://api.cloudflare.com/client/v4/graphql",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
      body:JSON.stringify({query,variables:{a:account,d:since,t:sinceTime}})},15000);
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.errors&&d.errors.length)return{configured:true,ok:false,detail:trimText((d.errors&&d.errors[0]&&d.errors[0].message)||("HTTP "+r.status),200)};
    const acc=(d.data&&d.data.viewer&&d.data.viewer.accounts&&d.data.viewer.accounts[0])||{};
    const sum=(rows,k)=>(rows||[]).reduce((s,x)=>s+(finiteNumber(x.sum&&x.sum[k])||0),0);
    return{configured:true,ok:true,day:since,
      workers:{requests:sum(acc.workers,"requests"),errors:sum(acc.workers,"errors"),limit:100000},
      d1:{rowsRead:sum(acc.d1,"rowsRead"),rowsWritten:sum(acc.d1,"rowsWritten"),readLimit:5000000,writeLimit:100000}};
  }catch(error){return{configured:true,ok:false,detail:trimText(String(error&&error.message||error),160)}}
}
async function handleAdmin(request,env,user,json,url){
  if(request.method!=="GET")return json({error:"Method not allowed"},405);
  if(!await isAdminUser(env,user))return json({error:"Solo para la cuenta de administración."},403);
  const day="d:"+nowIso().slice(0,10),month="m:"+nowIso().slice(0,7);
  const usageRows=await withCacheDb(env,async db=>{await ensureProviderUsageSchema(db);return(await db.prepare("SELECT provider,period,calls,errors,last_at,last_error FROM provider_usage WHERE period IN (?,?)").bind(day,month).all()).results||[]}).catch(()=>[]);
  const usage=(id,period)=>usageRows.find(r=>r.provider===id&&r.period===period)||null;
  const probe=url.searchParams.get("probe")==="1";
  let probes={};
  if(probe&&env.HOT_STATE_KV){try{probes=await env.HOT_STATE_KV.get("admin-probes:v1","json")||{}}catch(_){}}
  const needProbe=probe&&!probes.at;
  const providers=await Promise.all(PROVIDERS.map(async p=>{
    const configured=!p.secret||!!providerKey(env,p);
    let test=probes[p.id]||null;
    if(needProbe&&configured)test=await providerProbe(env,p);
    const d=usage(p.id,day),m=usage(p.id,month);
    return{id:p.id,label:p.label,kind:p.kind,secret:p.secret,free:p.free,dashboard:p.dashboard,configured,
      cooldownUntil:(providerCooldown.get(p.id)||0)>Date.now()?new Date(providerCooldown.get(p.id)).toISOString():null,
      today:d?{calls:d.calls,errors:d.errors}:{calls:0,errors:0},month:m?{calls:m.calls,errors:m.errors,lastAt:m.last_at,lastError:m.last_error}:{calls:0,errors:0},
      monthlyLimit:p.monthlyLimit||null,test};
  }));
  if(needProbe&&env.HOT_STATE_KV){const save={at:nowIso()};providers.forEach(p=>{if(p.test)save[p.id]=p.test});try{await env.HOT_STATE_KV.put("admin-probes:v1",JSON.stringify(save),{expirationTtl:3600})}catch(_){}}
  const account=String(env.CF_ACCOUNT_ID||"").trim(),project=String(env.FIREBASE_PROJECT_ID||"").trim();
  const infra=[
    {label:"Código (GitHub)",detail:"jjlunav/ViewInvAI",url:"https://github.com/jjlunav/ViewInvAI"},
    {label:"Compilaciones y APK (GitHub Actions)",detail:"build-android.yml",url:"https://github.com/jjlunav/ViewInvAI/actions"},
    {label:"Web y servidor (Cloudflare Worker)",detail:"viewinvai",url:account?"https://dash.cloudflare.com/"+account+"/workers/services/view/viewinvai/production":"https://dash.cloudflare.com/"},
    {label:"Base de datos personal (Cloudflare D1)",detail:"viewinvai-db",url:account?"https://dash.cloudflare.com/"+account+"/workers/d1":"https://dash.cloudflare.com/"},
    {label:"Estado rápido (Cloudflare KV)",detail:"HOT_STATE_KV",url:account?"https://dash.cloudflare.com/"+account+"/workers/kv/namespaces":"https://dash.cloudflare.com/"},
    {label:"Cachés de mercado (Turso)",detail:cacheDbLabel(cacheDb(env))==="turso"?"activa":"no activa (se usa D1)",url:"https://app.turso.tech/"},
    {label:"Acceso y avisos (Firebase)",detail:project||"",url:project?"https://console.firebase.google.com/project/"+project+"/overview":"https://console.firebase.google.com/"},
    {label:"Secretos (Variables and Secrets)",detail:"donde se guardan las claves",url:account?"https://dash.cloudflare.com/"+account+"/workers/services/view/viewinvai/production/settings":"https://dash.cloudflare.com/"}
  ];
  return json({generatedAt:nowIso(),providers,probedAt:probes.at||(needProbe?nowIso():null),infra,
    cloudflare:await cloudflareUsage(env),turso:{active:cacheDbLabel(cacheDb(env))},
    secrets:{ADMIN_EMAILS:!!String(env.ADMIN_EMAILS||"").trim(),CF_ANALYTICS_TOKEN:!!String(env.CF_ANALYTICS_TOKEN||"").trim(),CF_ACCOUNT_ID:!!String(env.CF_ACCOUNT_ID||"").trim()}});
}

let positionDecisionsSchemaReady=false;
// Solo avisos que piden una acción: vender (o vender sin pérdidas al recuperar) y comprar.
const DECISION_ALERT_TYPES=["position-sell","position-recovered","radar-ai"];
async function ensurePositionDecisionsSchema(env){
  if(positionDecisionsSchemaReady)return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS position_decisions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,position_id TEXT NOT NULL,stock_key TEXT NOT NULL DEFAULT '',ticker TEXT NOT NULL DEFAULT '',subject_type TEXT NOT NULL DEFAULT 'position',decision TEXT NOT NULL CHECK(decision IN ('hold','sell','later','buy','skip')),alert_id TEXT,avg_price REAL,price_at_decision REAL,loss_pct_at_decision REAL,last_risk_loss_pct REAL,review_at TEXT,recovered_notified_at TEXT,average_notified_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_position_decisions_position ON position_decisions(user_id,position_id)")
  ]);
  const cols=await env.DB.prepare("PRAGMA table_info(alert_events)").all();
  if(!(cols.results||[]).some(c=>c.name==="subject_id"))await env.DB.prepare("ALTER TABLE alert_events ADD COLUMN subject_id TEXT").run();
  // «Decidir» del Objetivo: tipo de espera, precio de venta objetivo, stop de emergencia (en €) y fecha.
  const dcols=new Set(((await env.DB.prepare("PRAGMA table_info(position_decisions)").all()).results||[]).map(c=>String(c.name)));
  for(const [name,type] of [["hold_mode","TEXT"],["hold_pct","REAL"],["target_eur","REAL"],["emergency_eur","REAL"],["hold_until","TEXT"]]){
    if(!dcols.has(name))await env.DB.prepare("ALTER TABLE position_decisions ADD COLUMN "+name+" "+type).run();
  }
  positionDecisionsSchemaReady=true;
}
async function positionDecisionFor(env,userId,positionId){
  await ensurePositionDecisionsSchema(env);
  return env.DB.prepare("SELECT * FROM position_decisions WHERE user_id=? AND position_id=?").bind(userId,positionId).first();
}
function decisionIsCurrent(decision,nowMs=Date.now()){
  if(!decision)return false;
  if(decision.decision==="hold")return true;
  const until=new Date(decision.review_at||0).getTime();
  return Number.isFinite(until)&&until>nowMs;
}
async function handlePositionDecisions(request,env,user,json,parts){
  await ensurePositionDecisionsSchema(env);
  const positionId=trimText(parts[1]||"",80);
  if(request.method==="GET"&&!positionId){
    const since=new Date(Date.now()-21*24*3600e3).toISOString();
    const alerts=await env.DB.prepare(
      "SELECT id,stock_key,ticker,name,alert_type,severity,title,message,created_at,read_at,subject_id FROM alert_events WHERE user_id=? AND created_at>=? AND alert_type IN ("+DECISION_ALERT_TYPES.map(()=>"?").join(",")+") ORDER BY created_at DESC LIMIT 200"
    ).bind(user.id,since,...DECISION_ALERT_TYPES).all();
    const positions=await env.DB.prepare(
      "SELECT p.id,p.portfolio_id,p.stock_key,p.ticker,p.name,p.prefer_tr,p.quantity,p.avg_price,p.currency,p.last_signal,p.last_score,f.name AS portfolio_name FROM positions p LEFT JOIN portfolios f ON f.id=p.portfolio_id WHERE p.user_id=? AND p.active=1"
    ).bind(user.id).all();
    const watch=await env.DB.prepare(
      "SELECT id,stock_key,ticker,name,prefer_tr,last_signal,last_score,last_confidence FROM watchlist WHERE user_id=?"
    ).bind(user.id).all();
    const decisions=await env.DB.prepare("SELECT * FROM position_decisions WHERE user_id=?").bind(user.id).all();
    const byPosition=new Map((decisions.results||[]).map(d=>[d.position_id,d]));
    const posRows=positions.results||[],watchRows=watch.results||[];
    const pending=[],seen=new Set(),buyCutoff=new Date(Date.now()-3*24*3600e3).toISOString();
    for(const alert of alerts.results||[]){
      if(alert.alert_type==="radar-ai"){
        // Señal de compra en un favorito: vigente 3 días.
        if(String(alert.created_at||"")<buyCutoff)continue;
        const w=alert.subject_id?watchRows.find(x=>x.id===alert.subject_id):watchRows.find(x=>x.stock_key===alert.stock_key);
        if(!w||seen.has(w.id))continue;
        seen.add(w.id);
        const d=byPosition.get(w.id);
        if(d&&String(d.updated_at||"")>=String(alert.created_at||""))continue;
        pending.push({kind:"buy",alert,watch:w,decision:d||null});
        continue;
      }
      const targets=alert.subject_id?posRows.filter(p=>p.id===alert.subject_id):posRows.filter(p=>p.stock_key===alert.stock_key);
      for(const pos of targets){
        if(seen.has(pos.id))continue;
        seen.add(pos.id); // solo el aviso más reciente de cada posición
        const d=byPosition.get(pos.id);
        const decidedAfter=d&&String(d.updated_at||"")>=String(alert.created_at||"");
        if(decidedAfter&&(decisionIsCurrent(d)||d.decision==="hold"))continue;
        if(decidedAfter&&d.decision==="sell")continue;
        pending.push({kind:"sell",alert,position:pos,decision:d||null});
      }
    }
    return json({pending,decisions:decisions.results||[],positions:posRows.filter(p=>byPosition.has(p.id))});
  }
  if(request.method==="POST"&&!positionId){
    const body=await readJson(request);
    const id=trimText(body.positionId,80);
    const decision=String(body.decision||"");
    const watchId=trimText(body.watchId,80);
    if(watchId){
      if(!["buy","skip","later"].includes(decision))return json({error:"Decisión no válida."},400);
      const w=await env.DB.prepare("SELECT id,stock_key,ticker FROM watchlist WHERE id=? AND user_id=?").bind(watchId,user.id).first();
      if(!w)return json({error:"Favorito no encontrado."},404);
      const now=nowIso(),days=decision==="skip"?14:decision==="buy"?7:3;
      const reviewAt=new Date(Date.now()+days*24*3600e3).toISOString(),alertId=trimText(body.alertId,80)||null;
      await env.DB.prepare(
        "INSERT INTO position_decisions (id,user_id,position_id,subject_type,stock_key,ticker,decision,alert_id,price_at_decision,review_at,created_at,updated_at) VALUES (?,?,?,'watch',?,?,?,?,?,?,?,?) "+
        "ON CONFLICT(user_id,position_id) DO UPDATE SET decision=excluded.decision,alert_id=excluded.alert_id,price_at_decision=excluded.price_at_decision,review_at=excluded.review_at,updated_at=excluded.updated_at"
      ).bind(uid("pd_"),user.id,w.id,w.stock_key,w.ticker,decision,alertId,finiteNumber(body.price),reviewAt,now,now).run();
      if(alertId)await env.DB.prepare("UPDATE alert_events SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?").bind(now,alertId,user.id).run();
      return json({decision:await env.DB.prepare("SELECT * FROM position_decisions WHERE user_id=? AND position_id=?").bind(user.id,w.id).first()});
    }
    if(!["hold","sell","later"].includes(decision))return json({error:"Decisión no válida."},400);
    const holdMode=["recover","pct","catalyst","better","date"].includes(String(body.holdMode||""))?String(body.holdMode):null;
    const holdUntil=/^\d{4}-\d{2}-\d{2}$/.test(String(body.holdUntil||""))?String(body.holdUntil):null;
    if((holdMode==="catalyst"||holdMode==="date")&&!holdUntil)return json({error:"Falta la fecha."},400);
    const posNum=v=>{const n=finiteNumber(v);return n!==null&&n>0?n:null};
    const pos=await env.DB.prepare("SELECT id,stock_key,ticker,avg_price FROM positions WHERE id=? AND user_id=?").bind(id,user.id).first();
    if(!pos)return json({error:"Posición no encontrada."},404);
    const price=finiteNumber(body.price);
    const avg=finiteNumber(pos.avg_price);
    const lossPct=price!==null&&avg!==null&&avg>0?(price/avg-1)*100:null;
    const now=nowIso();
    const days=Math.max(1,Math.min(60,finiteNumber(body.days)??7));
    // Las esperas con fecha (catalizador o pausa) terminan al acabar ese día: después el Objetivo vuelve a decidir.
    const reviewAt=holdUntil&&decision==="later"?new Date(Date.parse(holdUntil+"T23:59:59Z")).toISOString()
      :decision==="later"?new Date(Date.now()+days*24*3600e3).toISOString():decision==="sell"?new Date(Date.now()+3*24*3600e3).toISOString():null;
    const alertId=trimText(body.alertId,80)||null;
    await env.DB.prepare(
      "INSERT INTO position_decisions (id,user_id,position_id,stock_key,ticker,decision,alert_id,avg_price,price_at_decision,loss_pct_at_decision,last_risk_loss_pct,review_at,recovered_notified_at,average_notified_at,hold_mode,hold_pct,target_eur,emergency_eur,hold_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?) "+
      "ON CONFLICT(user_id,position_id) DO UPDATE SET decision=excluded.decision,alert_id=excluded.alert_id,avg_price=excluded.avg_price,price_at_decision=excluded.price_at_decision,loss_pct_at_decision=excluded.loss_pct_at_decision,last_risk_loss_pct=excluded.last_risk_loss_pct,review_at=excluded.review_at,recovered_notified_at=excluded.recovered_notified_at,average_notified_at=NULL,hold_mode=excluded.hold_mode,hold_pct=excluded.hold_pct,target_eur=excluded.target_eur,emergency_eur=excluded.emergency_eur,hold_until=excluded.hold_until,updated_at=excluded.updated_at"
    ).bind(uid("pd_"),user.id,pos.id,pos.stock_key,pos.ticker,decision,alertId,avg,price,lossPct,lossPct,reviewAt,lossPct!==null&&lossPct>=0?now:null,
      holdMode,holdMode==="pct"?posNum(body.holdPct):null,holdMode==="recover"||holdMode==="pct"?posNum(body.targetEur):null,holdMode?posNum(body.emergencyEur):null,holdUntil,now,now).run();
    if(alertId)await env.DB.prepare("UPDATE alert_events SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?").bind(now,alertId,user.id).run();
    return json({decision:await env.DB.prepare("SELECT * FROM position_decisions WHERE user_id=? AND position_id=?").bind(user.id,pos.id).first()});
  }
  if(request.method==="DELETE"&&positionId){
    await env.DB.prepare("DELETE FROM position_decisions WHERE user_id=? AND position_id=?").bind(user.id,positionId).run();
    return json({deleted:true});
  }
  return json({error:"Method not allowed"},405);
}
// Avisos para una posición que el usuario decidió mantener en pérdidas.
const esNumber=(v,d)=>Number(v).toFixed(d).replace(".",",");
function holdModeAlert(target,current,decision,nowMs=Date.now()){
  const price=finiteNumber(current.quotePrice),avg=finiteNumber(target.avg_price);
  const sameCurrency=String(current.quoteCurrency||"").toUpperCase()===String(target.currency||"").toUpperCase();
  if(price===null||avg===null||avg<=0||!sameCurrency||current.quoteVerified!==true)return null;
  const lossPct=(price/avg-1)*100;
  if(lossPct>=0&&!decision.recovered_notified_at){
    return {type:"position-recovered",severity:"high",field:"recovered_notified_at",
      title:"Recuperada · "+target.ticker,
      message:"Vuelve a tu precio de compra ("+esNumber(avg,2)+"). Puedes vender sin pérdidas o seguir manteniendo."};
  }
  const lastAverage=new Date(decision.average_notified_at||0).getTime();
  if(lossPct<=-8&&current.signal==="HOLD"&&finiteNumber(current.score)!==null&&current.score>=62&&
     (!Number.isFinite(lastAverage)||nowMs-lastAverage>14*24*3600e3)){
    return {type:"position-average",severity:"info",field:"average_notified_at",
      title:"Oportunidad de promediar · "+target.ticker,
      message:"El análisis mejora (score "+Math.round(current.score)+") y cotiza un "+esNumber(Math.abs(lossPct),1)+" % por debajo de tu precio medio. Comprar más ahora bajaría tu precio de equilibrio."};
  }
  const lastRisk=finiteNumber(decision.last_risk_loss_pct)??finiteNumber(decision.loss_pct_at_decision);
  if(lastRisk!==null&&lossPct<=lastRisk-15){
    return {type:"position-hold-risk",severity:"warning",field:"last_risk_loss_pct",value:lossPct,
      title:"Sigue cayendo · "+target.ticker,
      message:"Desde que decidiste mantener ha bajado hasta "+esNumber(lossPct,1)+" % frente a tu precio medio. Revisa si la tesis sigue en pie."};
  }
  return null;
}

async function maybeCreateAlert(env, target, stock, current, previous, notificationSettings=null, assetPreference=null) {
  const previousEngine = previous ? String(previous.engine || "") : "";
  const previousCompatible = previous && (previousEngine.startsWith("viewinvai-score/") || previousEngine.startsWith("viewinvai-hybrid/"));
  const previousScore = previousCompatible ? finiteNumber(previous.score) : null;
  const delta = previousScore === null ? 0 : current.score - previousScore;
  const settings = await analysisSettingsForUser(env, target.user_id);
  const globalNotifications = notificationSettings || await globalNotificationSettingsForUser(env, target.user_id);
  if (!globalNotifications.enabled) return null;
  let should = false;
  let type = "analysis-change";
  let severity = "info";

  if (target.subject_type === "position") {
    if (!globalNotifications.portfolio) return null;
    // Posición congelada entera: no se avisa de vender ni de deterioro hasta que pase la fecha.
    const frozen = serverFrozenQty(target);
    if (frozen > 0 && frozen >= (finiteNumber(target.quantity) ?? 0) - 1e-9) return null;
    const decision = await positionDecisionFor(env, target.user_id, target.subject_id);
    // Decisiones del menú «Decidir» (con tipo): sus avisos (objetivo, emergencia, cambio mejor) los da el Objetivo.
    if (decision && decision.hold_mode && decisionIsCurrent(decision)) return null;
    if (decision && decision.decision === "hold") {
      const hold = holdModeAlert(target, current, decision);
      if (!hold) return null;
      const id = uid("al_"), now = nowIso();
      await env.DB.prepare(
        "INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,snapshot_id,subject_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(id, target.user_id, target.stock_key, target.ticker, stock.name || target.name || "", hold.type, hold.severity, hold.title, hold.message, current.snapshotId, target.subject_id, now).run();
      await env.DB.prepare("UPDATE position_decisions SET " + hold.field + "=?,updated_at=updated_at WHERE id=?").bind(hold.field === "last_risk_loss_pct" ? hold.value : now, decision.id).run();
      const alert = { id, alert_type: hold.type, severity: hold.severity, title: hold.title, message: hold.message };
      try { await dispatchPushAlert(env, alert, target); }
      catch (error) { console.warn("Push alert dispatch failed", String(error && error.message || error)); }
      return id;
    }
    if (decisionIsCurrent(decision)) return null; // «decidir más tarde» o «venderé»: sin repetir el aviso
    if (current.signal === "SELL" && current.quoteVerified===true && current.confidence >= settings.minSellConfidence && (!previous || previous.signal !== "SELL")) {
      should = true; type = "position-sell"; severity = "critical";
    } else if (current.signal === "REVIEW" && current.quoteVerified===true && current.confidence >= Math.max(60, settings.minSellConfidence - 2) && (!previous || previous.signal === "HOLD")) {
      should = true; type = "position-review"; severity = "warning";
    } else if (previousScore !== null && delta <= -settings.notifyScoreChange) {
      should = true; type = "position-deterioration"; severity = "warning";
    }
  } else {
    const radarConfigured=globalNotifications.radarAi &&
      (notificationPreferenceAllows(assetPreference,"pulse_enabled",false)||notificationPreferenceAllows(assetPreference,"radar_enabled",false));
    if (!radarConfigured) return null;
    const watchDecision = await positionDecisionFor(env, target.user_id, target.subject_id);
    const buyHeld = decisionIsCurrent(watchDecision); // «compraré», «no compro» o «más tarde»: sin repetir la señal
    if (!buyHeld && globalNotifications.radarHigh && current.signal === "BUY" && current.quoteVerified===true && current.confidence >= settings.minBuyConfidence && (!previous || previous.signal !== "BUY")) {
      should = true; type = "radar-ai"; severity = "high";
    } else if (globalNotifications.radarOpportunity && current.quoteVerified===true && previousScore !== null && delta >= settings.notifyScoreChange && current.score > 20) {
      should = true; type = "radar-ai-improving"; severity = "info";
    }
  }

  if (!should) return null;

  const id = uid("al_");
  const now = nowIso();
  const title = target.subject_type === "position"
    ? (current.signal === "SELL" ? "Revisar salida · " : "Cambio en cartera · ") + target.ticker
    : (type === "radar-ai" ? "Radar AI · " : "Radar AI mejora · ") + target.ticker;
  const message = current.thesis || current.riskSummary || "Cambio relevante detectado en el análisis.";

  await ensurePositionDecisionsSchema(env);
  await env.DB.prepare(
    "INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,snapshot_id,subject_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    id, target.user_id, target.stock_key, target.ticker, stock.name || target.name || "",
    type, severity, title, message, current.snapshotId, target.subject_id || null, now
  ).run();

  const alert = { id, alert_type: type, severity, title, message };
  try { await dispatchPushAlert(env, alert, target); }
  catch (error) { console.warn("Push alert dispatch failed", String(error && error.message || error)); }
  return id;
}

async function analyzeTarget(env, target, services, {useAi=true}={}) {
  const snapshot = await services.loadMarketSnapshot(env);
  const stock = findStock(snapshot, target);
  if (!stock) throw new Error("Stock not found in market snapshot: " + target.stock_key);

  let verifiedQuote=null;
  if(services.loadQuote){
    try{verifiedQuote=await services.loadQuote(stock,target)}
    catch(error){console.warn("Verified analysis quote unavailable",String(error&&error.message||error))}
  }
  const quoteVerified=!!(verifiedQuote&&finiteNumber(verifiedQuote.price)!==null);
  const analysisStock=Object.assign({},stock);
  if(quoteVerified){
    if(Number(target.prefer_tr)===1){
      analysisStock.trLivePrice=finiteNumber(verifiedQuote.price);
      analysisStock.trLiveBid=finiteNumber(verifiedQuote.bid);
      analysisStock.trLiveAsk=finiteNumber(verifiedQuote.ask);
      analysisStock.trLiveChangePct=finiteNumber(verifiedQuote.changePct);
      analysisStock.trLiveUpdatedAt=verifiedQuote.timestamp||nowIso();
    }else{
      analysisStock.usLivePrice=finiteNumber(verifiedQuote.price);
      analysisStock.usLiveBid=finiteNumber(verifiedQuote.bid);
      analysisStock.usLiveAsk=finiteNumber(verifiedQuote.ask);
      analysisStock.usLiveChangePct=finiteNumber(verifiedQuote.changePct);
      analysisStock.usLiveVolume=finiteNumber(verifiedQuote.volume)??analysisStock.usLiveVolume;
      analysisStock.usLiveTimestamp=verifiedQuote.timestamp||nowIso();
      analysisStock.usLiveSource=verifiedQuote.source||"Nasdaq";
      analysisStock.usLiveIsRealTime=verifiedQuote.isRealTime===true;
    }
  }

  let chartRaw = null;
  try { chartRaw = await services.loadChart(analysisStock, target); } catch (error) {
    console.warn("Chart analysis unavailable", String(error && error.message || error));
  }
  const chart = chartFeatures(chartRaw);
  let directNews=[],officialEvents=[];
  if(services.loadOfficialEvents){
    try{officialEvents=await services.loadOfficialEvents(analysisStock,target)}
    catch(error){console.warn("Official analysis events unavailable",String(error&&error.message||error))}
  }
  if(services.loadNews){
    try{directNews=await services.loadNews(analysisStock,target)}
    catch(error){console.warn("Direct news analysis unavailable",String(error&&error.message||error))}
  }
  const events = mergeEventRows(mergeEventRows(recentEvents(snapshot,analysisStock,18),officialEvents,24),directNews,24);
  const fallback = deterministicAssessment(target, analysisStock, chart, events);
  const current = useAi ? await aiAssessment(env, target, analysisStock, chart, events, fallback) : fallback;
  current.quoteVerified=quoteVerified;
  current.quoteSource=trimText(verifiedQuote&&verifiedQuote.source,120);
  current.quoteTimestamp=verifiedQuote&&verifiedQuote.timestamp||null;
  current.quotePrice=quoteVerified?finiteNumber(verifiedQuote.price):null;
  current.quoteCurrency=Number(target.prefer_tr)===1?"EUR":"USD";

  const previous = await env.DB.prepare(
    "SELECT id,signal,confidence,score,engine,thesis,risk_summary,market_json,created_at FROM analysis_snapshots WHERE user_id=? AND subject_type=? AND subject_id=? ORDER BY created_at DESC LIMIT 1"
  ).bind(target.user_id, target.subject_type, target.subject_id).first();

  const now = nowIso(),previousAge=previous?Date.now()-new Date(previous.created_at||0).getTime():Infinity;
  let previousPrice=null;
  try{previousPrice=finiteNumber(JSON.parse(previous&&previous.market_json||"{}").price)}catch(_){}
  const currentPrice=quoteVerified?finiteNumber(verifiedQuote.price):null;
  const priceMove=previousPrice&&currentPrice?Math.abs(currentPrice/previousPrice-1)*100:0;
  const resultChanged=!previous||
    String(previous.signal||"")!==String(current.signal||"")||
    Math.abs((finiteNumber(previous.confidence)??0)-(finiteNumber(current.confidence)??0))>=5||
    Math.abs((finiteNumber(previous.score)??0)-(finiteNumber(current.score)??0))>=5;
  const keepHistory=resultChanged||priceMove>=1||!Number.isFinite(previousAge)||previousAge>=60*60000;
  const snapshotId=keepHistory?uid("an_"):String(previous&&previous.id||"");
  current.snapshotId=snapshotId;
  let automaticWrites=0;

  if(keepHistory){
    await env.DB.prepare(
      "INSERT INTO analysis_snapshots (id,user_id,subject_type,subject_id,stock_key,ticker,signal,confidence,score,previous_score,horizon,thesis,risk_summary,reasons_json,catalysts_json,technical_json,market_json,ai_model,engine,data_timestamp,created_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      snapshotId, target.user_id, target.subject_type, target.subject_id, target.stock_key, target.ticker,
      current.signal, current.confidence, current.score, previous ? previous.score : null, current.horizon,
      current.thesis, current.riskSummary, JSON.stringify(current.reasons || []), JSON.stringify(current.catalysts || []),
      JSON.stringify(chart || {}), JSON.stringify({
        market: Number(target.prefer_tr) === 1 ? "Trade Republic / LSX" : "EEUU",
        currency: Number(target.prefer_tr) === 1 ? "EUR" : "USD",
        quoteVerified,
        quoteSource: trimText(verifiedQuote&&verifiedQuote.source,120),
        quoteTimestamp: verifiedQuote&&verifiedQuote.timestamp||null,
        price: currentPrice,
        bid: quoteVerified ? finiteNumber(verifiedQuote.bid) : null,
        ask: quoteVerified ? finiteNumber(verifiedQuote.ask) : null,
        changePct: quoteVerified ? finiteNumber(verifiedQuote.changePct) : null,
        relVolume: analysisStock.relVolume ?? null,
        volume: Number(target.prefer_tr)===1 ? null : (analysisStock.usLiveVolume ?? analysisStock.volume ?? null),
        rsi: analysisStock.rsi ?? null,
        adx: analysisStock.adx ?? null,
        ema20: analysisStock.ema20 ?? null,
        ema50: analysisStock.ema50 ?? null
      }), current.model || "", current.engine || "", snapshot && snapshot.meta && snapshot.meta.updatedAt || null, now
    ).run();
    automaticWrites++;
  }

  const table = target.subject_type === "position" ? "positions" : "watchlist";
  const stateChanged=resultChanged||String(target.last_snapshot_id||"")!==snapshotId;
  if(stateChanged){
    await env.DB.prepare(
      "UPDATE " + table + " SET last_analysis_at=?,last_signal=?,last_confidence=?,last_score=?,last_snapshot_id=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(now,current.signal,current.confidence,current.score,snapshotId,now,target.subject_id,target.user_id).run();
  }else{
    await env.DB.prepare("UPDATE " + table + " SET last_analysis_at=? WHERE id=? AND user_id=?")
      .bind(now,target.subject_id,target.user_id).run();
  }
  automaticWrites++;

  const notificationSettings=await globalNotificationSettingsForUser(env,target.user_id);
  const assetNotificationPreference=await notificationPreferenceForTarget(env,target);
  await maybeCreateAlert(env,target,stock,current,previous,notificationSettings,assetNotificationPreference);
  if(notificationSettings.enabled&&notificationSettings.newsEvents&&notificationPreferenceAllows(assetNotificationPreference,"news_enabled",false)){
    await maybeCreateNewsAlerts(env,target,stock,events,snapshotId);
    await maybeCreateEventAlerts(env,target,stock,events,snapshotId);
  }

  return {
    id: snapshotId,
    stockKey: target.stock_key,
    ticker: target.ticker,
    name: stock.name || target.name || "",
    subjectType: target.subject_type,
    subjectId: target.subject_id,
    signal: current.signal,
    confidence: current.confidence,
    score: current.score,
    previousScore: previous ? previous.score : null,
    horizon: current.horizon,
    thesis: current.thesis,
    riskSummary: current.riskSummary,
    reasons: current.reasons || [],
    catalysts: current.catalysts || [],
    engine: current.engine,
    model: current.model,
    createdAt: now,
    automaticWrites
  };
}

async function subjectForUser(env, userId, subjectType, subjectId) {
  if (subjectType === "position") {
    return env.DB.prepare(
      "SELECT 'position' AS subject_type,id AS subject_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,quantity,avg_price,currency,last_analysis_at FROM positions WHERE id=? AND user_id=? AND active=1"
    ).bind(subjectId, userId).first();
  }
  if (subjectType === "watchlist") {
    return env.DB.prepare(
      "SELECT 'watchlist' AS subject_type,id AS subject_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,NULL AS quantity,NULL AS avg_price,'EUR' AS currency,last_analysis_at FROM watchlist WHERE id=? AND user_id=?"
    ).bind(subjectId, userId).first();
  }
  return null;
}


let portfolioGoalSchemaReady=false;
async function ensurePortfolioGoalSchema(env){
  if(portfolioGoalSchemaReady)return;
  await ensurePortfolioMarketSchema(env);
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS portfolio_goals ("+
    "portfolio_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,target_value_eur REAL NOT NULL,target_date TEXT,monthly_contribution_eur REAL NOT NULL DEFAULT 0,risk_profile TEXT NOT NULL DEFAULT 'aggressive',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,"+
    "FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  const goalColumns=await env.DB.prepare("PRAGMA table_info(portfolio_goals)").all();
  const goalColumnNames=new Set((goalColumns.results||[]).map(row=>String(row.name||"")));
  for(const [name,sql] of [
    ["target_date","ALTER TABLE portfolio_goals ADD COLUMN target_date TEXT"],
    ["monthly_contribution_eur","ALTER TABLE portfolio_goals ADD COLUMN monthly_contribution_eur REAL NOT NULL DEFAULT 0"],
    ["risk_profile","ALTER TABLE portfolio_goals ADD COLUMN risk_profile TEXT NOT NULL DEFAULT 'aggressive'"],
    // Objetivo «rápido» (goal-engine): nº de acciones, especulativas, punto de partida para medir el
    // ritmo, máximo alcanzado (modo defensivo) y estado defensivo.
    ["max_positions","ALTER TABLE portfolio_goals ADD COLUMN max_positions INTEGER NOT NULL DEFAULT 5"],
    ["allow_spec","ALTER TABLE portfolio_goals ADD COLUMN allow_spec INTEGER NOT NULL DEFAULT 1"],
    ["start_value_eur","ALTER TABLE portfolio_goals ADD COLUMN start_value_eur REAL"],
    ["start_date","ALTER TABLE portfolio_goals ADD COLUMN start_date TEXT"],
    ["peak_value_eur","ALTER TABLE portfolio_goals ADD COLUMN peak_value_eur REAL"],
    ["defensive","ALTER TABLE portfolio_goals ADD COLUMN defensive INTEGER NOT NULL DEFAULT 0"]
  ]){
    if(!goalColumnNames.has(name))await env.DB.prepare(sql).run();
  }
  try{
    const legacy=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_portfolio_goals'").first();
    if(legacy){
      await env.DB.prepare(
        "INSERT OR IGNORE INTO portfolio_goals (portfolio_id,user_id,target_value_eur,created_at,updated_at) "+
        "SELECT p.id,p.user_id,g.target_profit_eur,g.created_at,g.updated_at FROM portfolios p "+
        "JOIN stock_portfolio_goals g ON g.user_id=p.user_id"
      ).run();
    }
  }catch(error){console.warn("Portfolio goal legacy migration skipped",String(error&&error.message||error))}
  // Stop vigente y máximo de cada posición del Objetivo (el stop que sube nunca baja).
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS portfolio_goal_position_state (portfolio_id TEXT NOT NULL,user_id TEXT NOT NULL,stock_key TEXT NOT NULL,peak_eur REAL,stop_eur REAL,updated_at TEXT NOT NULL,"+
    "PRIMARY KEY(portfolio_id,stock_key),FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  portfolioGoalSchemaReady=true;
}
const GOAL_SELECT="SELECT g.portfolio_id,g.user_id,g.target_value_eur,g.target_date,g.monthly_contribution_eur,g.risk_profile,g.max_positions,g.allow_spec,g.start_value_eur,g.start_date,g.peak_value_eur,g.defensive,g.created_at,g.updated_at,s.review_day,s.candidates AS review_candidates,s.plan_json "+
  "FROM portfolio_goals g LEFT JOIN portfolio_goal_notification_state s ON s.portfolio_id=g.portfolio_id AND s.user_id=g.user_id ";
async function goalWithPositionState(env,userId,goal){
  if(!goal)return null;
  const {results}=await env.DB.prepare("SELECT stock_key,peak_eur,stop_eur,updated_at FROM portfolio_goal_position_state WHERE user_id=? AND portfolio_id=?").bind(userId,goal.portfolio_id).all();
  return{...goal,position_state:results||[]};
}
async function handlePortfolioGoal(request,env,user,json,url){
  await ensurePortfolioGoalSchema(env);
  await ensurePortfolioGoalNotificationStateSchema(env);
  if(request.method==="GET"){
    const portfolioId=trimText(url.searchParams.get("portfolioId"),80);
    if(portfolioId){
      if(!(await onePortfolio(env,user.id,portfolioId)))return json({error:"Portfolio not found"},404);
      const goal=await env.DB.prepare(GOAL_SELECT+"WHERE g.portfolio_id=? AND g.user_id=?").bind(portfolioId,user.id).first();
      return json({goal:await goalWithPositionState(env,user.id,goal)});
    }
    const rows=await env.DB.prepare(GOAL_SELECT+"WHERE g.user_id=? ORDER BY g.updated_at DESC").bind(user.id).all();
    const goals=[];for(const g of rows.results||[])goals.push(await goalWithPositionState(env,user.id,g));
    return json({goals});
  }
  if(request.method==="PUT"||request.method==="PATCH"||request.method==="POST"){
    const body=await readJson(request),portfolioId=trimText(body.portfolioId,80);
    if(!portfolioId||!(await onePortfolio(env,user.id,portfolioId)))return json({error:"Portfolio not found"},404);
    const raw=finiteNumber(body.targetValueEur!==undefined?body.targetValueEur:body.targetProfitEur);
    if(raw===null||raw<=0)return json({error:"targetValueEur must be greater than zero"},400);
    const target=Math.max(1,Math.min(100000000,Math.round(raw*100)/100)),now=nowIso();
    const existing=await env.DB.prepare(
      "SELECT portfolio_id,target_value_eur,target_date,monthly_contribution_eur,risk_profile,max_positions,allow_spec,start_value_eur,start_date FROM portfolio_goals WHERE portfolio_id=? AND user_id=?"
    ).bind(portfolioId,user.id).first();
    const rawDate=body.targetDate!==undefined?trimText(body.targetDate,10):(existing&&existing.target_date||"");
    let targetDate=rawDate||null;
    if(targetDate&&!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return json({error:"targetDate must use YYYY-MM-DD"},400);
    if(targetDate){
      const parsed=new Date(targetDate+"T23:59:59Z");
      if(!Number.isFinite(parsed.getTime()))return json({error:"targetDate is invalid"},400);
      if(parsed.getTime()<Date.now()-86400000)return json({error:"targetDate must not be in the past"},400);
    }
    const contributionRaw=body.monthlyContributionEur!==undefined?finiteNumber(body.monthlyContributionEur):finiteNumber(existing&&existing.monthly_contribution_eur);
    const monthlyContribution=Math.max(0,Math.min(1000000,Math.round((contributionRaw||0)*100)/100));
    const requestedRisk=String(body.riskProfile!==undefined?body.riskProfile:(existing&&existing.risk_profile||"aggressive")).trim().toLowerCase();
    const riskProfile=["conservative","balanced","aggressive"].includes(requestedRisk)?requestedRisk:"aggressive";
    const maxPositions=Math.max(1,Math.min(10,Math.round(finiteNumber(body.maxPositions)??finiteNumber(existing&&existing.max_positions)??5)));
    const requestedSpec=body.specMode!==undefined?finiteNumber(body.specMode):null;
    const allowSpec=requestedSpec!==null
      ?Math.max(0,Math.min(3,Math.round(requestedSpec)))
      :body.allowSpec!==undefined?(body.allowSpec===false?0:1)
      :(existing?Math.max(0,Math.min(3,Math.round(finiteNumber(existing.allow_spec)??1))):1);
    // El ritmo se mide desde que se fija (o cambia) el objetivo o su fecha.
    const restart=!existing||body.restartPace===true||Number(existing.target_value_eur)!==target||String(existing.target_date||"")!==String(targetDate||"")||!existing.start_date;
    const startValue=restart?finiteNumber(body.currentValueEur):finiteNumber(existing.start_value_eur);
    const startDate=restart?now:existing.start_date;
    await env.DB.prepare(
      "INSERT INTO portfolio_goals (portfolio_id,user_id,target_value_eur,target_date,monthly_contribution_eur,risk_profile,max_positions,allow_spec,start_value_eur,start_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) "+
      "ON CONFLICT(portfolio_id) DO UPDATE SET target_value_eur=excluded.target_value_eur,target_date=excluded.target_date,monthly_contribution_eur=excluded.monthly_contribution_eur,risk_profile=excluded.risk_profile,"+
      "max_positions=excluded.max_positions,allow_spec=excluded.allow_spec,start_value_eur=excluded.start_value_eur,start_date=excluded.start_date,updated_at=excluded.updated_at"
    ).bind(portfolioId,user.id,target,targetDate,monthlyContribution,riskProfile,maxPositions,allowSpec,startValue!==null&&startValue>0?Math.round(startValue*100)/100:null,startDate,now,now).run();
    const goal=await env.DB.prepare(GOAL_SELECT+"WHERE g.portfolio_id=? AND g.user_id=?").bind(portfolioId,user.id).first();
    return json({goal:await goalWithPositionState(env,user.id,goal)},existing?200:201);
  }
  if(request.method==="DELETE"){
    const portfolioId=trimText(url.searchParams.get("portfolioId"),80);
    if(!portfolioId)return json({error:"portfolioId required"},400);
    await env.DB.prepare("DELETE FROM portfolio_goals WHERE portfolio_id=? AND user_id=?").bind(portfolioId,user.id).run();
    return json({goal:null,deleted:true});
  }
  return json({error:"Method not allowed"},405);
}


let portfolioGoalHistorySchemaReady=false;
async function ensurePortfolioGoalHistorySchema(env){
  if(portfolioGoalHistorySchemaReady)return;
  await ensurePortfolioGoalSchema(env);
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS portfolio_goal_recommendation_history ("+
    "id TEXT PRIMARY KEY,portfolio_id TEXT NOT NULL,user_id TEXT NOT NULL,signature TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',plan_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,"+
    "FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_portfolio_goal_history_lookup ON portfolio_goal_recommendation_history(user_id,portfolio_id,created_at DESC)"
  ).run();
  portfolioGoalHistorySchemaReady=true;
}
function portfolioGoalHistoryPlan(body){
  const raw=body&&body.plan&&typeof body.plan==="object"?body.plan:{};
  const json=JSON.stringify(raw);
  if(json.length>20000)throw new Error("Goal history payload too large");
  return json;
}
async function handlePortfolioGoalHistory(request,env,user,json,url){
  await ensurePortfolioGoalHistorySchema(env);
  const portfolioId=trimText(
    request.method==="GET"?url.searchParams.get("portfolioId"):"",
    80
  );
  if(request.method==="GET"){
    if(!portfolioId||!(await onePortfolio(env,user.id,portfolioId)))return json({error:"Portfolio not found"},404);
    const rows=await env.DB.prepare(
      "SELECT id,portfolio_id,signature,summary,plan_json,created_at FROM portfolio_goal_recommendation_history WHERE user_id=? AND portfolio_id=? ORDER BY created_at DESC LIMIT 10"
    ).bind(user.id,portfolioId).all();
    return json({history:(rows.results||[]).map(row=>{
      let plan={};try{plan=JSON.parse(row.plan_json||"{}")}catch(_){}
      return{id:row.id,portfolio_id:row.portfolio_id,signature:row.signature,summary:row.summary,plan,created_at:row.created_at};
    })});
  }
  if(request.method==="POST"){
    const body=await readJson(request),pid=trimText(body.portfolioId,80);
    if(!pid||!(await onePortfolio(env,user.id,pid)))return json({error:"Portfolio not found"},404);
    const signature=trimText(body.signature,500),summary=trimText(body.summary,2000);
    if(!signature)return json({error:"signature required"},400);
    const latest=await env.DB.prepare(
      "SELECT id,signature FROM portfolio_goal_recommendation_history WHERE user_id=? AND portfolio_id=? ORDER BY created_at DESC LIMIT 1"
    ).bind(user.id,pid).first();
    if(latest&&String(latest.signature||"")===signature)return json({stored:false,deduplicated:true,id:latest.id});
    const id=uid("gph_"),now=nowIso(),planJson=portfolioGoalHistoryPlan(body);
    await env.DB.prepare(
      "INSERT INTO portfolio_goal_recommendation_history (id,portfolio_id,user_id,signature,summary,plan_json,created_at) VALUES (?,?,?,?,?,?,?)"
    ).bind(id,pid,user.id,signature,summary,planJson,now).run();
    await env.DB.prepare(
      "DELETE FROM portfolio_goal_recommendation_history WHERE user_id=? AND portfolio_id=? AND id NOT IN ("+
      "SELECT id FROM portfolio_goal_recommendation_history WHERE user_id=? AND portfolio_id=? ORDER BY created_at DESC LIMIT 10)"
    ).bind(user.id,pid,user.id,pid).run();
    return json({stored:true,id,created_at:now},201);
  }
  return json({error:"Method not allowed"},405);
}

async function handleSettings(request, env, user, json) {
  await ensureGlobalNotificationSettingsSchema(env);
  const existing = await env.DB.prepare(
    "SELECT analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change FROM user_settings WHERE user_id=?"
  ).bind(user.id).first();
  const notifications=await globalNotificationSettingsForUser(env,user.id);
  const current=Object.assign({
    analysis_positions_minutes:10,
    analysis_watchlist_minutes:30,
    min_buy_confidence:85,
    min_sell_confidence:80,
    notify_score_change:20
  },existing||{},{
    notifications_enabled:notifications.enabled?1:0,
    notify_news_events:notifications.newsEvents?1:0,
    notify_catalyst_eve:notifications.catalystEve?1:0,
    notify_radar:notifications.radar?1:0,
    notify_radar_high:notifications.radarHigh?1:0,
    notify_radar_opportunity:notifications.radarOpportunity?1:0,
    notify_radar_watch:notifications.radarWatch?1:0,
    notify_price:notifications.price?1:0,
    notify_portfolio:notifications.portfolio?1:0,
    notify_portfolio_goal:notifications.portfolioGoal?1:0
  });

  if (request.method === "GET") return json({ settings: current });
  if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);

  const body = await readJson(request);
  const next = {
    positions: Math.max(5, Math.min(240, Math.round(finiteNumber(body.analysisPositionsMinutes) ?? finiteNumber(current.analysis_positions_minutes) ?? 10))),
    watchlist: Math.max(10, Math.min(1440, Math.round(finiteNumber(body.analysisWatchlistMinutes) ?? finiteNumber(current.analysis_watchlist_minutes) ?? 30))),
    buy: Math.max(60, Math.min(99, Math.round(finiteNumber(body.minBuyConfidence) ?? finiteNumber(current.min_buy_confidence) ?? 85))),
    sell: Math.max(60, Math.min(99, Math.round(finiteNumber(body.minSellConfidence) ?? finiteNumber(current.min_sell_confidence) ?? 80))),
    change: Math.max(5, Math.min(60, Math.round(finiteNumber(body.notifyScoreChange) ?? finiteNumber(current.notify_score_change) ?? 20))),
    enabled: body.notificationsEnabled === undefined ? Number(current.notifications_enabled)!==0 : booleanInt(body.notificationsEnabled)===1,
    newsEvents: body.notifyNewsEvents === undefined ? Number(current.notify_news_events)!==0 : booleanInt(body.notifyNewsEvents)===1,
    catalystEve: body.notifyCatalystEve === undefined ? Number(current.notify_catalyst_eve)!==0 : booleanInt(body.notifyCatalystEve)===1,
    radarHigh: body.notifyRadarHigh === undefined ? Number(current.notify_radar_high)!==0 : booleanInt(body.notifyRadarHigh)===1,
    radarOpportunity: body.notifyRadarOpportunity === undefined ? Number(current.notify_radar_opportunity)!==0 : booleanInt(body.notifyRadarOpportunity)===1,
    radarWatch: body.notifyRadarWatch === undefined ? Number(current.notify_radar_watch)!==0 : booleanInt(body.notifyRadarWatch)===1,
    price: body.notifyPrice === undefined ? Number(current.notify_price)!==0 : booleanInt(body.notifyPrice)===1,
    portfolio: body.notifyPortfolio === undefined ? Number(current.notify_portfolio)!==0 : booleanInt(body.notifyPortfolio)===1,
    portfolioGoal: body.notifyPortfolioGoal === undefined ? Number(current.notify_portfolio_goal)!==0 : booleanInt(body.notifyPortfolioGoal)===1
  };
  next.radar=next.radarHigh||next.radarOpportunity||next.radarWatch;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user_settings (user_id,analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET analysis_positions_minutes=excluded.analysis_positions_minutes,analysis_watchlist_minutes=excluded.analysis_watchlist_minutes,min_buy_confidence=excluded.min_buy_confidence,min_sell_confidence=excluded.min_sell_confidence,notify_score_change=excluded.notify_score_change,updated_at=excluded.updated_at"
    ).bind(user.id,next.positions,next.watchlist,next.buy,next.sell,next.change,now,now),
    env.DB.prepare(
      "INSERT INTO user_notification_settings (user_id,opted_in_explicitly,notifications_enabled,news_events_enabled,catalyst_eve_enabled,pulse_ai_enabled,radar_enabled,radar_high_enabled,radar_opportunity_enabled,radar_watch_enabled,price_enabled,portfolio_enabled,portfolio_goal_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(user_id) DO UPDATE SET opted_in_explicitly=1,notifications_enabled=excluded.notifications_enabled,news_events_enabled=excluded.news_events_enabled,catalyst_eve_enabled=excluded.catalyst_eve_enabled,pulse_ai_enabled=0,radar_enabled=excluded.radar_enabled,radar_high_enabled=excluded.radar_high_enabled,radar_opportunity_enabled=excluded.radar_opportunity_enabled,radar_watch_enabled=excluded.radar_watch_enabled,price_enabled=excluded.price_enabled,portfolio_enabled=excluded.portfolio_enabled,portfolio_goal_enabled=excluded.portfolio_goal_enabled,updated_at=excluded.updated_at"
    ).bind(user.id,1,next.enabled?1:0,next.newsEvents?1:0,next.catalystEve?1:0,0,next.radar?1:0,next.radarHigh?1:0,next.radarOpportunity?1:0,next.radarWatch?1:0,next.price?1:0,next.portfolio?1:0,next.portfolioGoal?1:0,now,now)
  ]);
  const saved=await env.DB.prepare(
    "SELECT analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change FROM user_settings WHERE user_id=?"
  ).bind(user.id).first();
  return json({settings:Object.assign({},saved||{},{
    notifications_enabled:next.enabled?1:0,
    notify_news_events:next.newsEvents?1:0,
    notify_catalyst_eve:next.catalystEve?1:0,
    notify_radar:next.radar?1:0,
    notify_radar_high:next.radarHigh?1:0,
    notify_radar_opportunity:next.radarOpportunity?1:0,
    notify_radar_watch:next.radarWatch?1:0,
    notify_price:next.price?1:0,
    notify_portfolio:next.portfolio?1:0,
    notify_portfolio_goal:next.portfolioGoal?1:0
  })});
}


let uiPreferencesSchemaReady=false;
async function ensureUiPreferencesSchema(env){
  if(uiPreferencesSchemaReady)return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS user_ui_preferences ("+
    "user_id TEXT NOT NULL,scope TEXT NOT NULL,preferences_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL,"+
    "PRIMARY KEY(user_id,scope),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  uiPreferencesSchemaReady=true;
}
function validUiPreferenceScope(value){
  const scope=String(value||"").trim();
  return /^[a-z0-9._:-]{1,64}$/i.test(scope)?scope:"";
}
async function handleUiPreferences(request,env,user,json,url){
  await ensureUiPreferencesSchema(env);
  if(request.method==="GET"){
    const scope=validUiPreferenceScope(url.searchParams.get("scope"));
    if(!scope)return json({error:"Valid scope required"},400);
    const row=await env.DB.prepare(
      "SELECT preferences_json,updated_at FROM user_ui_preferences WHERE user_id=? AND scope=?"
    ).bind(user.id,scope).first();
    let preferences={};
    try{preferences=row&&row.preferences_json?JSON.parse(row.preferences_json):{}}catch(_){preferences={}}
    return json({scope,preferences,updatedAt:row&&row.updated_at||null},200,{"Cache-Control":"no-store"});
  }
  if(request.method!=="PUT"&&request.method!=="PATCH")return json({error:"Method not allowed"},405);
  const body=await readJson(request),scope=validUiPreferenceScope(body.scope);
  if(!scope)return json({error:"Valid scope required"},400);
  const preferences=body.preferences&&typeof body.preferences==="object"&&!Array.isArray(body.preferences)?body.preferences:{};
  const raw=JSON.stringify(preferences);
  if(raw.length>20000)return json({error:"Preferences payload too large"},413);
  const now=nowIso();
  await env.DB.prepare(
    "INSERT INTO user_ui_preferences (user_id,scope,preferences_json,updated_at) VALUES (?,?,?,?) "+
    "ON CONFLICT(user_id,scope) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at"
  ).bind(user.id,scope,raw,now).run();
  return json({scope,preferences,updatedAt:now},200,{"Cache-Control":"no-store"});
}

let notificationSchemaReady=false;
async function ensureNotificationPreferenceSchema(env){
  if(notificationSchemaReady)return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS notification_preferences ("+
    "id TEXT PRIMARY KEY,user_id TEXT NOT NULL,stock_key TEXT NOT NULL,ticker TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',prefer_tr INTEGER NOT NULL DEFAULT 0,"+
    "news_enabled INTEGER NOT NULL DEFAULT 0,pulse_enabled INTEGER NOT NULL DEFAULT 0,radar_enabled INTEGER NOT NULL DEFAULT 0,price_up_enabled INTEGER NOT NULL DEFAULT 0,price_down_enabled INTEGER NOT NULL DEFAULT 0,"+
    "price_up_step REAL NOT NULL DEFAULT 3,price_down_step REAL NOT NULL DEFAULT 3,anchor_price REAL,last_up_bucket INTEGER NOT NULL DEFAULT 0,last_down_bucket INTEGER NOT NULL DEFAULT 0,last_pulse_state TEXT NOT NULL DEFAULT '',last_radar_state TEXT NOT NULL DEFAULT '',last_ai_scan_at TEXT,"+
    "created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  const prefColumns=await env.DB.prepare("PRAGMA table_info(notification_preferences)").all();
  const prefNames=new Set((prefColumns.results||[]).map(row=>String(row.name||"")));
  if(!prefNames.has("last_ai_scan_at")){
    await env.DB.prepare("ALTER TABLE notification_preferences ADD COLUMN last_ai_scan_at TEXT").run();
  }
  // Exact price levels (one-shot): cleared once they fire.
  for(const col of ["price_above","price_below"]){
    if(!prefNames.has(col))await env.DB.prepare("ALTER TABLE notification_preferences ADD COLUMN "+col+" REAL").run();
  }
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_pref_user_stock ON notification_preferences(user_id,stock_key,prefer_tr)").run();
  notificationSchemaReady=true;
}

async function handleNotificationPreferences(request,env,user,json,url){
  await ensureNotificationPreferenceSchema(env);
  const stockKey=trimText(url.searchParams.get("stockKey"),120).toUpperCase();
  const preferTr=booleanInt(url.searchParams.get("preferTr"));
  if(request.method==="GET"){
    const rows=stockKey
      ?await env.DB.prepare("SELECT * FROM notification_preferences WHERE user_id=? AND stock_key=? AND prefer_tr=? LIMIT 1").bind(user.id,stockKey,preferTr).all()
      :await env.DB.prepare("SELECT * FROM notification_preferences WHERE user_id=? ORDER BY updated_at DESC").bind(user.id).all();
    return json({preferences:rows.results||[]});
  }
  if(request.method==="PUT"||request.method==="POST"){
    const body=await readJson(request),key=trimText(body.stockKey,120).toUpperCase();
    if(!key)return json({error:"stockKey is required"},400);
    const pt=booleanInt(body.preferTr),now=nowIso();
    const existing=await env.DB.prepare("SELECT id,anchor_price FROM notification_preferences WHERE user_id=? AND stock_key=? AND prefer_tr=?").bind(user.id,key,pt).first();
    const id=existing&&existing.id?existing.id:uid("np_");
    const positive=v=>{if(v===null||v===undefined||v==="")return null;const n=finiteNumber(v);return n!==null&&n>0?n:null};
    const anchorPrice=positive(body.anchorPrice)??positive(existing&&existing.anchor_price);
    const up=Math.max(.5,Math.min(50,finiteNumber(body.priceUpStep)??3));
    const down=Math.max(.5,Math.min(50,finiteNumber(body.priceDownStep)??3));
    const level=v=>{if(v===null||v===undefined||v==="")return null;const n=finiteNumber(v);return n!==null&&n>0&&n<1e7?n:null};
    const above=level(body.priceAbove),below=level(body.priceBelow);
    if(above!==null&&below!==null&&below>=above)return json({error:"El nivel inferior debe ser menor que el superior."},400);
    await env.DB.prepare(
      "INSERT INTO notification_preferences (id,user_id,stock_key,ticker,name,prefer_tr,news_enabled,pulse_enabled,radar_enabled,price_up_enabled,price_down_enabled,price_up_step,price_down_step,anchor_price,price_above,price_below,created_at,updated_at) "+
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,stock_key,prefer_tr) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,news_enabled=excluded.news_enabled,pulse_enabled=excluded.pulse_enabled,radar_enabled=excluded.radar_enabled,price_up_enabled=excluded.price_up_enabled,price_down_enabled=excluded.price_down_enabled,price_up_step=excluded.price_up_step,price_down_step=excluded.price_down_step,anchor_price=COALESCE(NULLIF(notification_preferences.anchor_price,0),excluded.anchor_price),price_above=excluded.price_above,price_below=excluded.price_below,updated_at=excluded.updated_at"
    ).bind(id,user.id,key,trimText(body.ticker,24).toUpperCase(),trimText(body.name,160),pt,booleanInt(body.newsEnabled),booleanInt(body.pulseEnabled),booleanInt(body.radarEnabled),booleanInt(body.priceUpEnabled),booleanInt(body.priceDownEnabled),up,down,anchorPrice,above,below,now,now).run();
    const pref=await env.DB.prepare("SELECT * FROM notification_preferences WHERE user_id=? AND stock_key=? AND prefer_tr=?").bind(user.id,key,pt).first();
    return json({preference:pref},existing?200:201);
  }
  if(request.method==="DELETE"){
    if(!stockKey)return json({error:"stockKey is required"},400);
    await env.DB.prepare("DELETE FROM notification_preferences WHERE user_id=? AND stock_key=? AND prefer_tr=?").bind(user.id,stockKey,preferTr).run();
    return json({deleted:true});
  }
  return json({error:"Method not allowed"},405);
}

async function sendPreferenceAlert(env,pref,type,severity,title,message){
  const global=await globalNotificationSettingsForUser(env,pref.user_id);
  if(!global.enabled)return null;
  if(type==="pulse-ai"||type==="radar-entry"||type==="radar-ai"||type==="radar-ai-change"){
    const cutoff=new Date(Date.now()-10*60*1000).toISOString();
    const duplicate=await env.DB.prepare(
      "SELECT id FROM alert_events WHERE user_id=? AND stock_key=? AND alert_type=? AND created_at>=? ORDER BY created_at DESC LIMIT 1"
    ).bind(pref.user_id,pref.stock_key,type,cutoff).first();
    if(duplicate&&duplicate.id)return duplicate.id;
  }
  const id=uid("al_"),now=nowIso();
  await env.DB.prepare("INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id,pref.user_id,pref.stock_key,pref.ticker,pref.name||"",type,severity,title,message,now).run();
  await dispatchPushAlert(env,{id,alert_type:type,severity,title,message},pref);
  return id;
}

async function scanNotificationPreferences(env,services,{allowAi=true}={}){
  await ensureNotificationPreferenceSchema(env);
  await ensureGlobalNotificationSettingsSchema(env);
  const rows=await env.DB.prepare(
    "SELECT p.* FROM notification_preferences p LEFT JOIN user_notification_settings g ON g.user_id=p.user_id "+
    "WHERE COALESCE(g.opted_in_explicitly,0)=1 AND COALESCE(g.notifications_enabled,0)<>0 AND ("+
    "(COALESCE(g.news_events_enabled,0)<>0 AND COALESCE(p.news_enabled,0)<>0) OR "+
    "((COALESCE(g.radar_high_enabled,0)<>0 OR COALESCE(g.radar_opportunity_enabled,0)<>0 OR COALESCE(g.radar_watch_enabled,0)<>0) AND (COALESCE(p.radar_enabled,0)<>0 OR COALESCE(p.pulse_enabled,0)<>0)) OR "+
    "(COALESCE(g.price_enabled,0)<>0 AND (COALESCE(p.price_up_enabled,0)<>0 OR COALESCE(p.price_down_enabled,0)<>0 OR p.price_above IS NOT NULL OR p.price_below IS NOT NULL))) "+
    "ORDER BY p.user_id,p.id"
  ).all();
  if(!(rows.results||[]).length)return{processed:0};
  const snapshot=await services.loadMarketSnapshot(env),results=[],globalByUser=new Map();let writes=0;
  for(const pref of rows.results||[]){
    try{
      let global=globalByUser.get(pref.user_id);
      if(!global){global=await globalNotificationSettingsForUser(env,pref.user_id);globalByUser.set(pref.user_id,global)}
      if(!global.enabled)continue;
      const stock=findStock(snapshot,pref);
      if(!stock)continue;
      const pulseConfigured=global.pulseAi&&Number(pref.pulse_enabled)===1;
      const radarConfigured=global.radar&&(Number(pref.radar_enabled)===1||Number(pref.pulse_enabled)===1);
      const signalConfigured=pulseConfigured||radarConfigured;
      // Keep the same 5-minute alert-analysis cadence without persisting a heartbeat row
      // on every scan. Each preference is deterministically assigned to one minute bucket.
      // A missed cron is retried on the next matching bucket; no alert category is disabled.
      const aiSlot=(()=>{
        const s=String(pref.id||pref.stock_key||"");
        let h=0;
        for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;
        return h%5;
      })();
      const aiDue=allowAi&&signalConfigured&&(Math.floor(Date.now()/60000)%5===aiSlot);
      // NULL means "no level" (finiteNumber(null) would read it as 0).
      const priceLevel=v=>{if(v===null||v===undefined||v==="")return null;const n=finiteNumber(v);return n!==null&&n>0?n:null};
      const priceLevelsSet=priceLevel(pref.price_above)!==null||priceLevel(pref.price_below)!==null;
      const trPriceConfigured=global.price&&Number(pref.prefer_tr)===1&&(Number(pref.price_up_enabled)===1||Number(pref.price_down_enabled)===1||priceLevelsSet);
      let chart={available:false},chartRaw=null;
      if(trPriceConfigured||aiDue){
        try{chartRaw=await services.loadChart(stock,pref);chart=chartFeatures(chartRaw)}
        catch(error){console.warn("Notification chart unavailable",pref.id,String(error&&error.message||error))}
      }
      // A TR/LSX alert must never be evaluated from the US quote. Use the exact
      // LSX chart/ticker when available; otherwise wait instead of mixing markets.
      let liveQuote=null;
      const priceAlertConfigured=global.price&&(Number(pref.price_up_enabled)===1||Number(pref.price_down_enabled)===1||priceLevelsSet);
      if(Number(pref.prefer_tr)!==1&&priceAlertConfigured&&services.loadQuote){
        try{liveQuote=await services.loadQuote(stock,pref)}
        catch(error){console.warn("Notification live quote unavailable",pref.id,String(error&&error.message||error))}
      }
      const price=Number(pref.prefer_tr)===1
        ?(chart&&chart.available?finiteNumber(chart.last):null)
        // Only a live quote may move a price alert; snapshot pre/post/close prices can belong to a
        // previous session and would fire false threshold crossings when the live quote fails.
        :finiteNumber((liveQuote&&liveQuote.price)??stock.usLivePrice);
      let anchorPrice=priceLevel(pref.anchor_price);
      if(anchorPrice===null&&price!==null&&price>0){
        anchorPrice=price;
        await env.DB.prepare("UPDATE notification_preferences SET anchor_price=?,updated_at=? WHERE id=?").bind(anchorPrice,nowIso(),pref.id).run();writes++;
      }
      let upBucket=Number(pref.last_up_bucket)||0,downBucket=Number(pref.last_down_bucket)||0;
      if(anchorPrice&&price!==null){
        const pct=(price/anchorPrice-1)*100,upStep=Math.max(.5,finiteNumber(pref.price_up_step)??3),downStep=Math.max(.5,finiteNumber(pref.price_down_step)??3);
        const nextUp=Math.floor(Math.max(0,pct)/upStep),nextDown=Math.floor(Math.max(0,-pct)/downStep);
        if(Number(pref.price_up_enabled)===1&&nextUp>upBucket){
          await sendPreferenceAlert(env,pref,"price-up","info","Subida · "+pref.ticker,"Ha superado +"+(nextUp*upStep).toFixed(1)+"% desde que activaste el aviso.");
          upBucket=nextUp;
        }
        if(Number(pref.price_down_enabled)===1&&nextDown>downBucket){
          await sendPreferenceAlert(env,pref,"price-down","warning","Bajada · "+pref.ticker,"Ha superado -"+(nextDown*downStep).toFixed(1)+"% desde que activaste el aviso.");
          downBucket=nextDown;
        }
      }
      if(global.price&&price!==null&&priceLevelsSet){
        const cur=Number(pref.prefer_tr)===1?"€":"$",fmt=v=>Number(v).toLocaleString("es-ES",{maximumFractionDigits:v<10?4:2})+" "+cur;
        const above=priceLevel(pref.price_above),below=priceLevel(pref.price_below);
        if(above!==null&&price>=above){
          await sendPreferenceAlert(env,pref,"price-level-up","high","Nivel alcanzado · "+pref.ticker,"Cotiza a "+fmt(price)+": ha superado tu nivel de "+fmt(above)+".");
          await env.DB.prepare("UPDATE notification_preferences SET price_above=NULL WHERE id=?").bind(pref.id).run();writes++;
        }
        if(below!==null&&price<=below){
          await sendPreferenceAlert(env,pref,"price-level-down","warning","Nivel alcanzado · "+pref.ticker,"Cotiza a "+fmt(price)+": ha caído por debajo de tu nivel de "+fmt(below)+".");
          await env.DB.prepare("UPDATE notification_preferences SET price_below=NULL WHERE id=?").bind(pref.id).run();writes++;
        }
      }
      let directNews=[],officialEvents=[];
      if(global.newsEvents&&Number(pref.news_enabled)===1){
        if(services.loadOfficialEvents){
          try{officialEvents=await services.loadOfficialEvents(stock,pref)}
          catch(error){console.warn("Official notification events unavailable",pref.id,String(error&&error.message||error))}
        }
        if(services.loadNews){
          try{directNews=await services.loadNews(stock,pref)}
          catch(error){console.warn("Notification news unavailable",pref.id,String(error&&error.message||error))}
        }
      }
      const events=mergeEventRows(mergeEventRows(recentEvents(snapshot,stock,18),officialEvents,24),directNews,24);
      if(global.newsEvents&&Number(pref.news_enabled)===1){
        await maybeCreateNewsAlerts(env,pref,stock,events,null);
        await maybeCreateEventAlerts(env,pref,stock,events,null);
      }
      let pulseState=String(pref.last_pulse_state||""),radarState=String(pref.last_radar_state||"");
      if(aiDue){
        const target={...pref,subject_type:"watchlist",subject_id:pref.id,avg_price:null,quantity:null,currency:Number(pref.prefer_tr)===1?"EUR":"USD"};
        const fallback=deterministicAssessment(target,stock,chart,events);
        let current=fallback;
        if(fallback.score>=68&&(finiteNumber(fallback.quality)??0)>=60)current=await aiAssessment(env,target,stock,chart,events,fallback);
        // Match the Radar AI screen (ViewInvAIScore.radarTier): high conviction needs the entry filter,
        // score>=68, data quality>=65, a chart and an AI buy with confidence>=70.
        // Opportunity uses the deterministic score like the screen; high conviction also needs a real
        // model answer (aiValidated), never the deterministic fallback.
        const radarQuality=finiteNumber(fallback.quality)??0,radarScore=finiteNumber(fallback.score)??0;
        const rt=globalThis.ViewInvAIScore&&typeof globalThis.ViewInvAIScore.radarTier==="function"
          ?globalThis.ViewInvAIScore.radarTier({score:radarScore,quality:radarQuality,price:finiteNumber(stock.price),marketCap:finiteNumber(stock.marketCap),avgVolume:finiteNumber(stock.avgVolume),events,market:Number(pref.prefer_tr)===1?"tr":"us"})
          :{tier:"",eligible:false};
        const nextRadar=rt.eligible&&current.aiValidated===true&&current.signal==="BUY"&&current.confidence>=70&&current.score>=68&&radarQuality>=65&&chart&&chart.available
          ?"HIGH"
          :(rt.tier==="opportunity"||rt.tier==="spec"?"OPPORTUNITY":rt.tier==="watch"?"WATCH":"");
        const nextPulse=String(current.signal||"WAIT").toUpperCase();
        const previousRadar=radarState;
        const previousPulse=pulseState;
        if(radarConfigured){
          const tierOn={HIGH:global.radarHigh,OPPORTUNITY:global.radarOpportunity,WATCH:global.radarWatch};
          const tierLabel={HIGH:"Alta convicción",OPPORTUNITY:"Oportunidad",WATCH:"En vigilancia"};
          if(nextRadar&&nextRadar!==previousRadar&&tierOn[nextRadar]){
            const engineSpec={speculative:rt.tier==="spec"};
            await sendPreferenceAlert(
              env,pref,"radar-ai-change",nextRadar==="HIGH"?"high":"info","Radar AI · "+tierLabel[nextRadar]+(engineSpec.speculative?" (especulativo)":"")+" · "+pref.ticker,
              current.thesis||("La acción ha entrado en «"+tierLabel[nextRadar]+"» de Radar AI.")
            );
          }else if(previousRadar&&!nextRadar&&tierOn[previousRadar]){
            await sendPreferenceAlert(env,pref,"radar-ai-exit","info","Salida de Radar AI · "+pref.ticker,current.riskSummary||"La acción ya no cumple los criterios activos de Radar AI.");
          }
        }
        pulseState=nextPulse;radarState=nextRadar;
      }
      const scanNow=nowIso(),scanChanged=upBucket!==Number(pref.last_up_bucket||0)||downBucket!==Number(pref.last_down_bucket||0)||
        pulseState!==String(pref.last_pulse_state||"")||radarState!==String(pref.last_radar_state||"");
      if(scanChanged){
        await env.DB.prepare("UPDATE notification_preferences SET last_up_bucket=?,last_down_bucket=?,last_pulse_state=?,last_radar_state=?,last_ai_scan_at=CASE WHEN ? THEN ? ELSE last_ai_scan_at END,updated_at=? WHERE id=?")
          .bind(upBucket,downBucket,pulseState,radarState,aiDue?1:0,scanNow,scanNow,pref.id).run();
        writes++;
      }
      results.push(pref.id);
    }catch(error){
      console.warn("Notification preference scan failed",pref.id,String(error&&error.message||error));
      // A transient scan failure must not generate a database write; the next cron retries it.
    }
  }
  return{processed:results.length,writes};
}

async function handleDevices(request, env, user, json, parts) {
  const id = parts[1] || "";
  if (request.method === "POST" && id === "test") {
    const settings=await globalNotificationSettingsForUser(env,user.id);
    if(!settings.enabled)return json({error:"Las notificaciones globales están desactivadas.",code:"notifications-disabled"},409);
    const devices=await env.DB.prepare("SELECT id,platform,app_version,enabled,last_seen_at FROM devices WHERE user_id=? AND enabled=1 ORDER BY last_seen_at DESC").bind(user.id).all();
    if(!(devices.results||[]).length)return json({error:"No hay ningún dispositivo push activo registrado.",code:"no-active-device"},409);
    const alertId=uid("al_"),now=nowIso(),title="ViewInvAI · prueba de notificación",message="Si ves este aviso, el canal push de esta instalación está funcionando.";
    await env.DB.prepare("INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(alertId,user.id,"","","","push-test","info",title,message,now).run();
    const result=await dispatchPushAlert(env,{id:alertId,alert_type:"push-test",severity:"info",title,message},{user_id:user.id,stock_key:"",ticker:"",prefer_tr:0});
    if(!result.configured)return json({error:"El servidor push no está configurado: falta FCM_SERVICE_ACCOUNT_JSON.",code:"push-backend-not-configured",result},503);
    if(result.error==="fcm-auth-failed")return json({error:"Firebase rechazó la autenticación del servidor push. Revisa FCM_SERVICE_ACCOUNT_JSON.",code:"push-auth-failed",result},502);
    if(result.sent<1)return json({error:"No se pudo entregar la notificación a ningún dispositivo activo.",code:"push-not-delivered",result},502);
    return json({ok:true,sent:result.sent,devices:(devices.results||[]).length,alertId});
  }
  if (request.method === "GET" && !id) {
    const rows = await env.DB.prepare(
      "SELECT id,platform,app_version,enabled,last_seen_at,created_at,updated_at FROM devices WHERE user_id=? ORDER BY last_seen_at DESC"
    ).bind(user.id).all();
    return json({ devices: rows.results || [], pushConfigured: !!fcmServiceAccount(env) });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const token = trimText(body.pushToken, 2048);
    const platform = trimText(body.platform || "android", 32).toLowerCase();
    const appVersion = trimText(body.appVersion, 40);
    if (!token) return json({ error: "pushToken is required" }, 400);
    const existing = await env.DB.prepare("SELECT id FROM devices WHERE push_token=?").bind(token).first();
    const deviceId = existing && existing.id ? existing.id : uid("dev_");
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO devices (id,user_id,platform,push_token,app_version,enabled,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?) " +
      "ON CONFLICT(push_token) DO UPDATE SET user_id=excluded.user_id,platform=excluded.platform,app_version=excluded.app_version,enabled=1,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at"
    ).bind(deviceId, user.id, platform, token, appVersion, now, now, now).run();
    return json({ device: { id: deviceId, platform, appVersion, enabled: true, lastSeenAt: now } }, existing ? 200 : 201);
  }

  if (!id) return json({ error: "Device id required" }, 400);
  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE devices SET enabled=0,updated_at=? WHERE id=? AND user_id=?").bind(nowIso(), id, user.id).run();
    return json({ deleted: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleManualAnalysis(request, env, user, json, services) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(request);
  const subjectType = trimText(body.subjectType, 20);
  const subjectId = trimText(body.subjectId, 80);
  const target = await subjectForUser(env, user.id, subjectType, subjectId);
  if (!target) return json({ error: "Tracked asset not found" }, 404);

  if (target.last_analysis_at) {
    const age = Date.now() - new Date(target.last_analysis_at).getTime();
    if (Number.isFinite(age) && age < 120000) {
      const latest = await env.DB.prepare(
        "SELECT * FROM analysis_snapshots WHERE user_id=? AND subject_type=? AND subject_id=? ORDER BY created_at DESC LIMIT 1"
      ).bind(user.id, subjectType, subjectId).first();
      return json({ analysis: latest, reused: true });
    }
  }

  try {
    const result = await analyzeTarget(env, target, services);
    return json({ analysis: result, reused: false });
  } catch (error) {
    console.warn("Manual analysis failed", String(error && error.message || error));
    return json({ error: "Analysis temporarily unavailable" }, 503);
  }
}


async function handleAiChat(request, env, user, json, services) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.AI || typeof env.AI.run !== "function") return json({ error: "AI temporarily unavailable" }, 503);

  const body = await readJson(request);
  const stockKey = trimText(body.stockKey, 120);
  const ticker = trimText(body.ticker, 24).toUpperCase();
  const preferTr = body.preferTr === true;
  const question = trimText(body.question, 1200);
  const history = Array.isArray(body.history) ? body.history.slice(-6).map(item => ({
    role: item && item.role === "assistant" ? "assistant" : "user",
    content: trimText(item && item.content, 1600)
  })).filter(x => x.content) : [];
  const clientLive = body.live && typeof body.live === "object" && !Array.isArray(body.live) ? body.live : {};
  if (!stockKey && !ticker) return json({ error: "Stock is required" }, 400);
  if (!question) return json({ error: "Question is required" }, 400);

  const snapshot = await services.loadMarketSnapshot(env);
  const target = {
    stock_key: stockKey,
    ticker,
    prefer_tr: preferTr ? 1 : 0,
    isin: trimText(body.isin, 32)
  };
  const stock = findStock(snapshot, target);
  if (!stock) return json({ error: "Stock not found" }, 404);

  let chartRaw = null;
  try { chartRaw = await services.loadChart(stock, target); } catch (error) {
    console.warn("AI chat chart unavailable", String(error && error.message || error));
  }
  const chart = chartFeatures(chartRaw);
  let directNews=[],officialEvents=[];
  if(services.loadOfficialEvents){
    try{officialEvents=await services.loadOfficialEvents(stock,target)}
    catch(error){console.warn("AI chat official events unavailable",String(error&&error.message||error))}
  }
  if(services.loadNews){
    try{directNews=await services.loadNews(stock,target)}
    catch(error){console.warn("AI chat live news unavailable",String(error&&error.message||error))}
  }
  const events = mergeEventRows(mergeEventRows(recentEvents(snapshot,stock,16),officialEvents,24),directNews,24);
  const fallbackTarget = { subject_type: "watchlist", ...target };
  const deterministic = deterministicAssessment(fallbackTarget, stock, chart, events);

  let serverQuote=null;
  if(services.loadQuote){
    try{serverQuote=await services.loadQuote(stock,target)}
    catch(error){console.warn("AI chat verified quote unavailable",String(error&&error.message||error))}
  }
  const quoteVerified=!!(serverQuote&&finiteNumber(serverQuote.price)!==null);
  const live=quoteVerified?serverQuote:clientLive;
  const livePrice = finiteNumber(live.price);
  const snapshotFx = finiteNumber(snapshot&&snapshot.meta&&snapshot.meta.eurUsd);
  const fx = finiteNumber(clientLive.eurUsd) ?? snapshotFx;
  const liveEur = preferTr
    ? livePrice
    : finiteNumber(clientLive.eur) ?? (livePrice!==null&&fx>0?livePrice/fx:null);
  const liveUsd = preferTr
    ? finiteNumber(clientLive.usd) ?? (livePrice!==null&&fx>0?livePrice*fx:null)
    : livePrice;
  const liveChange = finiteNumber(live.changePct);
  let model = configuredAiModel(env);

  const prompt = [
    "Eres ViewInvAI, un asistente de análisis bursátil integrado en una app de inversión.",
    "Responde SIEMPRE en español claro y concreto.",
    "Usa SOLO los datos estructurados suministrados. No inventes noticias, precios, fechas ni eventos.",
    "Distingue entre hechos del feed, cálculos derivados y valoración analítica.",
    "El precio principal debe corresponder al mercado elegido: si preferTr=true, LSX/Trade Republic en EUR; si es false, mercado EEUU en USD.",
    "La segunda divisa es únicamente una conversión con EUR/USD y no un segundo precio independiente.",
    "Evalúa momentum, tendencia, riesgo de FOMO, liquidez, técnicos, noticias/eventos y riesgos.",
    "No presentes una recomendación como certeza. Si faltan datos, dilo y baja la confianza.",
    "Si liveQuote.serverVerified es false, no emitas COMPRAR como señal actual: usa VIGILAR o ESPERAR y explica que falta una cotización verificada por el servidor.",
    "Devuelve JSON únicamente con las claves: answer, summary, signal, confidence, momentum, fomoRisk, trend, keyPoints.",
    "signal debe ser una de: COMPRAR, VIGILAR, ESPERAR, EVITAR.",
    "momentum, fomoRisk y trend deben ser textos cortos.",
    "",
    JSON.stringify({
      userQuestion: question,
      conversation: history,
      selectedMarket: preferTr ? "Trade Republic / LSX" : "EEUU",
      liveQuote: {
        serverVerified: quoteVerified,
        source: trimText(live.source, 120),
        nativeCurrency: preferTr ? "EUR" : "USD",
        price: livePrice,
        eur: liveEur,
        usd: liveUsd,
        changePct: liveChange,
        quoteUpdatedAt: trimText(live.timestamp || live.quoteUpdatedAt, 80),
        eurUsd: fx,
        fxUpdatedAt: trimText(clientLive.fxUpdatedAt, 80),
        bid: finiteNumber(live.bid),
        ask: finiteNumber(live.ask)
      },
      stock: {
        ticker: stock.ticker,
        name: stock.name,
        exchange: stock.exchange,
        trTicker: stock.trTicker || null,
        trExchange: stock.trExchange || null,
        isin: stock.isin || stock.trIsin || null,
        volume: stock.usLiveVolume ?? stock.volume ?? null,
        avgVolume: stock.avgVolume ?? null,
        relVolume: stock.relVolume ?? null,
        rsi: stock.rsi ?? null,
        adx: stock.adx ?? null,
        ema20: stock.ema20 ?? null,
        ema50: stock.ema50 ?? null,
        marketCap: stock.marketCap ?? null,
        earningsDate: stock.earningsDate || null
      },
      chart,
      recentEvents: events,
      deterministicReference: {
        signal: deterministic.signal,
        score: deterministic.score,
        reasons: deterministic.reasons
      },
      snapshotUpdatedAt: snapshot && snapshot.meta && snapshot.meta.updatedAt || null
    })
  ].join("\n");

  try {
    const run = await runWorkersAi(env, { prompt, max_tokens: 900, temperature: 0.12 }, model);
    const result = run.result; model = run.model;
    const parsed = extractAiJson(result);
    if (!parsed) throw new Error("AI response is not valid JSON");
    const allowed = new Set(["COMPRAR","VIGILAR","ESPERAR","EVITAR"]);
    let signal = String(parsed.signal || "VIGILAR").toUpperCase();
    if(!allowed.has(signal))signal="VIGILAR";
    let confidence=Math.max(0,Math.min(100,Math.round(finiteNumber(parsed.confidence)??55)));
    if(!quoteVerified&&signal==="COMPRAR"){signal="VIGILAR";confidence=Math.min(confidence,60)}
    return json({
      answer: trimText(parsed.answer || parsed.summary || "", 4000),
      summary: trimText(parsed.summary || parsed.answer || "", 900),
      signal,
      confidence,
      momentum: trimText(parsed.momentum || "Sin clasificación", 80),
      fomoRisk: trimText(parsed.fomoRisk || "No determinado", 80),
      trend: trimText(parsed.trend || "No determinada", 80),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(x => trimText(x, 240)).filter(Boolean).slice(0, 6) : [],
      model,
      quoteVerified,
      quoteSource: trimText(live.source,120),
      dataTimestamp: live.timestamp || snapshot && snapshot.meta && snapshot.meta.updatedAt || null
    });
  } catch (error) {
    console.warn("AI chat failed", String(error && error.message || error));
    let signalMap = deterministic.score >= 45 ? "COMPRAR" : deterministic.score < -20 ? "EVITAR" : deterministic.score >= 15 ? "VIGILAR" : "ESPERAR";
    // Same rule as the model: without a server-verified quote there is no current buy signal.
    if (!quoteVerified && signalMap === "COMPRAR") signalMap = "VIGILAR";
    return json({
      answer: deterministic.thesis + " " + deterministic.riskSummary,
      summary: deterministic.thesis,
      signal: signalMap,
      confidence: deterministic.confidence,
      momentum: chart && chart.available ? (chart.trendUp ? "Positivo" : "Débil / mixto") : "Datos insuficientes",
      fomoRisk: finiteNumber(stock.rsi) !== null && finiteNumber(stock.rsi) > 75 ? "Elevado" : "Moderado",
      trend: chart && chart.available ? (chart.trendUp ? "Alcista" : "No confirmada") : "Sin datos suficientes",
      keyPoints: deterministic.reasons || [],
      model: "",
      dataTimestamp: snapshot && snapshot.meta && snapshot.meta.updatedAt || null,
      fallback: true
    });
  }
}

export async function handleBackendApi(request, env, services = {}) {
  const json = services.jsonResponse || defaultJson;
  const guard = apiGuard(request);
  if (guard) return json({ error: guard.error }, guard.status);

  const url = new URL(request.url);
  if (url.pathname === "/api/backend/status") {
    const pushConfigured=!!fcmServiceAccount(env);
    const secUserAgent=String(env.SEC_USER_AGENT||"ViewInvAI/1.0 (https://viewinvai.firebaseapp.com)").trim();
    const secConfigured=!!secUserAgent;
    const openFdaKeyConfigured=!!String(env.OPENFDA_API_KEY||"").trim();
    return json({
      d1: !!env.DB,
      ai: !!env.AI,
      firebase: !!String(env.FIREBASE_PROJECT_ID || "").trim(),
      push: pushConfigured,
      model: configuredAiModel(env),
      aiHealth: await aiHealthStatus(env, url),
      cacheDb: await cacheDbStatus(env, url),
      webSearch: await tavilyStatus(env),
      alertsCadenceMinutes: 1,
      sources: {
        tradeRepublic: { integrated: true, configured: true, mode: "direct-origin", label: "Trade Republic / LSX" },
        nasdaq: { integrated: true, configured: true, mode: "direct-origin", label: "Nasdaq / EEUU" },
        sec: { integrated: true, configured: secConfigured, mode: String(env.SEC_USER_AGENT||"").trim() ? "custom-user-agent" : "identified-default", requiredConfig: null, label: "SEC / EDGAR" },
        clinicalTrials: { integrated: true, configured: true, mode: "official-public", label: "ClinicalTrials.gov" },
        fda: { integrated: true, configured: true, enhancedConfig: openFdaKeyConfigured, optionalConfig: openFdaKeyConfigured ? null : "OPENFDA_API_KEY", label: "FDA / openFDA" },
        push: { integrated: true, configured: pushConfigured, requiredConfig: pushConfigured ? null : "FCM service account", label: "Firebase Cloud Messaging" }
      },
      updatedAt: nowIso()
    });
  }

  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status || 401);
  const user = auth.user;
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // remove leading "api"
  const root = parts[0] || "";

  try {
    if (root === "me") return handleMe(request, env, user, json);
    if (root === "portfolios") return handlePortfolios(request, env, user, json, parts);
    if (root === "brokers") return handleBrokers(request, env, user, json, parts);
    if (root === "positions") return handlePositions(request, env, user, json, parts, url);
    if (root === "transactions") return handleTransactions(request, env, user, json, parts, url);
    if (root === "broker-sync") return handleBrokerSync(request, env, user, json, parts);
    if (root === "tax-report") return handleTaxReport(request, env, user, json, url);
    if (root === "dividends") return handleDividends(request, env, user, json, parts, url);
    if (root === "backup") return handleBackup(request, env, user, json);
    if (root === "portfolio-performance") return handlePortfolioPerformance(request, env, user, json, url, services);
    if (root === "fund-portfolios") return handleFundPortfolios(request, env, user, json, parts);
    if (root === "fund-positions") return handleFundPositions(request, env, user, json, parts, url);
    if (root === "fund-transactions") return handleFundTransactions(request, env, user, json, parts, url);
    if (root === "fund-plans") return handleFundPlans(request, env, user, json, parts, url);
    if (root === "fund-catalog-extra") return handleFundCatalogExtra(request, env, user, json);
    if (root === "watchlist") return handleWatchlist(request, env, user, json, parts);
    if (root === "analysis" && parts[1] === "run") return handleManualAnalysis(request, env, user, json, services);
    if (root === "analysis") return handleAnalysisList(request, env, user, json, url);
    if (root === "ai" && parts[1] === "chat") return handleAiChat(request, env, user, json, services);
    if (root === "ai" && (parts[1] === "keys" || parts[1] === "contrast")) return handleAiIntegration(request, env, user, json, parts, url);
    if (root === "alerts") return handleAlerts(request, env, user, json, parts);
    if (root === "position-decisions") return handlePositionDecisions(request, env, user, json, parts);
    if (root === "event-insight") return handleEventInsight(request, env, user, json, url, services);
    if (root === "admin") return handleAdmin(request, env, user, json, url);
    if (root === "notification-preferences") return handleNotificationPreferences(request, env, user, json, url);
    if (root === "portfolio-goal") return handlePortfolioGoal(request, env, user, json, url);
    if (root === "portfolio-goal-history") return handlePortfolioGoalHistory(request, env, user, json, url);
    if (root === "settings") return handleSettings(request, env, user, json);
    if (root === "ui-preferences") return handleUiPreferences(request, env, user, json, url);
    if (root === "devices") return handleDevices(request, env, user, json, parts);
    return json({ error: "Unknown backend endpoint" }, 404);
  } catch (error) {
    console.error("Backend API error", String(error && error.stack || error));
    if (String(error && error.message || "").includes("Payload too large")) return json({ error: "Payload too large" }, 413);
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
    return json({ error: "Backend request failed" }, 500);
  }
}

// ----- Integrar la IA (opcional): cada usuario conecta su propia IA para contrastar -----
// Los resultados del Radar AI y del Objetivo no cambian: esto solo añade una segunda
// opinión bajo petición. Las claves se guardan cifradas (AES-GCM con AI_KEYS_SECRET,
// ligadas al usuario) y nunca se devuelven; a la IA solo se envían datos públicos.
const AI_PROVIDERS={
  gemini:{label:"Gemini",model:"gemini-3.8-flash"},
  anthropic:{label:"Claude",model:"claude-opus-5-5"},
  openai:{label:"OpenAI",model:"gpt-5-mini"}
};
const AI_CONTRAST_DAILY_LIMIT=40;
// El Objetivo de la cartera tiene prioridad: el contraste automático del Radar solo usa lo que
// no está reservado para él (y nunca pasa del límite diario total).
const AI_GOAL_RESERVE=25;
const AI_SUBJECT_TYPES=new Set(["radar","goal","stock"]);
const AI_VERDICTS=new Set(["respalda","dudas","contradice","nota"]);
let aiIntegrationSchemaReady=false;
async function ensureAiIntegrationSchema(env){
  if(aiIntegrationSchemaReady)return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS user_ai_keys (user_id TEXT NOT NULL,provider TEXT NOT NULL,key_enc TEXT NOT NULL,iv TEXT NOT NULL,last4 TEXT NOT NULL DEFAULT '',model TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,provider),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_contrasts (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,subject_type TEXT NOT NULL,subject_key TEXT NOT NULL,day TEXT NOT NULL,provider TEXT NOT NULL,verdict TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',items_json TEXT NOT NULL DEFAULT '[]',sources_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ai_contrasts_user_subject ON ai_contrasts(user_id,subject_type,subject_key,day)")
  ]);
  aiIntegrationSchemaReady=true;
}
function aiB64(bytes){let s="";const a=new Uint8Array(bytes);for(let i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s)}
function aiUnB64(text){const s=atob(String(text||""));const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a}
async function aiCryptoKey(env){
  const secret=String(env.AI_KEYS_SECRET||"");
  if(secret.length<16)return null;
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("viewinvai-ai-keys:"+secret));
  return crypto.subtle.importKey("raw",hash,"AES-GCM",false,["encrypt","decrypt"]);
}
async function aiEncrypt(env,userId,provider,plain){
  const key=await aiCryptoKey(env);if(!key)return null;
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(userId+"|"+provider)},key,new TextEncoder().encode(plain));
  return{enc:aiB64(data),iv:aiB64(iv)};
}
async function aiDecrypt(env,userId,provider,row){
  const key=await aiCryptoKey(env);if(!key||!row)return "";
  try{
    const data=await crypto.subtle.decrypt({name:"AES-GCM",iv:aiUnB64(row.iv),additionalData:new TextEncoder().encode(userId+"|"+provider)},key,aiUnB64(row.key_enc));
    return new TextDecoder().decode(data);
  }catch(_){return ""}
}
function aiProviderOf(value){const p=String(value||"").trim().toLowerCase();return Object.prototype.hasOwnProperty.call(AI_PROVIDERS,p)?p:""}
function aiValidModel(value){const m=String(value||"").trim();return /^[a-z0-9][a-z0-9._:\/-]{1,79}$/i.test(m)?m:""}
async function aiFetch(url,init,timeoutMs=60000){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{return await fetch(url,{...init,signal:ctrl.signal})}finally{clearTimeout(timer)}
}
function aiProviderError(provider,status,data){
  const raw=String(data&&data.error&&(data.error.message||data.error.type)||data&&data.message||"").slice(0,200);
  if(status===401||status===403)return AI_PROVIDERS[provider].label+" rechaza la clave (no es válida o no tiene permisos).";
  if(status===429)return AI_PROVIDERS[provider].label+" no permite esta solicitud ahora mismo por cuota o límite del proyecto. Puede ocurrir incluso sin consumo previo; ViewInvAI probará otros modelos disponibles antes de mostrar este error.";
  if(status===503)return AI_PROVIDERS[provider].label+" está temporalmente saturado. ViewInvAI ya ha probado los modelos Flash disponibles y no ha conseguido una respuesta.";
  if(status===400&&/model/i.test(raw))return AI_PROVIDERS[provider].label+" no reconoce el modelo indicado: "+raw;
  return AI_PROVIDERS[provider].label+" respondió con un error ("+status+")"+(raw?": "+raw:".");
}
// Comprueba la clave con una llamada gratuita (listar modelos) antes de guardarla.
async function aiTestKey(provider,apiKey){
  let res;
  try{
    if(provider==="gemini")res=await aiFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",{headers:{"x-goog-api-key":apiKey}},15000);
    else if(provider==="anthropic")res=await aiFetch("https://api.anthropic.com/v1/models?limit=1",{headers:{"x-api-key":apiKey,"anthropic-version":"2023-06-01"}},15000);
    else res=await aiFetch("https://api.openai.com/v1/models",{headers:{Authorization:"Bearer "+apiKey}},15000);
  }catch(_){return{ok:false,error:"No se pudo contactar con "+AI_PROVIDERS[provider].label+". Inténtalo de nuevo."}}
  if(res.ok)return{ok:true};
  const data=await res.json().catch(()=>({}));
  return{ok:false,error:aiProviderError(provider,res.status,data)};
}
const AI_CONTRAST_SYSTEM=
  "Eres un analista financiero independiente. ViewInvAI, una app de análisis de bolsa, ha generado unas propuestas con su motor interno. "+
  "Tu trabajo es CONTRASTARLAS con información actual y verificable (noticias, resultados, guías, rebajas de rating, dilución, litigios, sector), "+
  "no repetirlas ni sustituir el análisis. Busca en la web lo necesario y sé concreto y prudente. No inventes datos: si no encuentras información, dilo. "+
  "Responde en español. Al final de tu respuesta incluye SOLO un bloque JSON válido con esta forma exacta:\n"+
  "{\"veredicto\":\"respalda|dudas|contradice\",\"resumen\":\"una o dos frases\",\"valores\":[{\"ticker\":\"XXX\",\"veredicto\":\"respalda|dudas|contradice\",\"motivo\":\"frase breve con el dato clave\"}]}\n"+
  "«respalda» = la información actual apoya la propuesta; «dudas» = hay riesgos o datos que la debilitan; «contradice» = hay hechos que la invalidan.";
function aiExtractJson(text){
  const raw=String(text||"");
  const fenced=raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  const candidates=[];
  if(fenced)candidates.push(fenced[1]);
  const last=raw.lastIndexOf("{\"veredicto\""),alt=raw.lastIndexOf("{");
  for(const start of [last,alt]){
    if(start<0)continue;
    const end=raw.lastIndexOf("}");
    if(end>start)candidates.push(raw.slice(start,end+1));
  }
  for(const c of candidates){try{const o=JSON.parse(c);if(o&&typeof o==="object")return o}catch(_){}}
  return null;
}
function aiNormalizeVerdict(value){
  const v=String(value||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
  if(v.startsWith("respald")||v==="confirma"||v==="confirmar")return "respalda";
  if(v.startsWith("contradi")||v==="descartar")return "contradice";
  if(v.startsWith("duda")||v==="bajar")return "dudas";
  return "";
}
function aiParseAnswer(text){
  const obj=aiExtractJson(text)||{};
  const items=(Array.isArray(obj.valores)?obj.valores:[]).slice(0,30).map(x=>({
    ticker:trimText(x&&x.ticker,24).toUpperCase(),
    verdict:aiNormalizeVerdict(x&&x.veredicto)||"dudas",
    reason:trimText(x&&x.motivo,400)
  })).filter(x=>x.ticker);
  const verdict=aiNormalizeVerdict(obj.veredicto)||(items.length?(items.some(x=>x.verdict==="contradice")?"contradice":items.some(x=>x.verdict==="dudas")?"dudas":"respalda"):"nota");
  let summary=trimText(obj.resumen,800);
  if(!summary){
    const cut=String(text||"").replace(/```[\s\S]*?```/g,"").replace(/\{[\s\S]*\}\s*$/,"").trim();
    summary=trimText(cut,800);
  }
  return{verdict,summary,items};
}
function aiCleanSources(list){
  const seen=new Set(),out=[];
  for(const s of list||[]){
    const url=String(s&&s.url||"").trim();
    if(!/^https:\/\//i.test(url)||seen.has(url))continue;
    seen.add(url);out.push({url:url.slice(0,500),title:trimText(s.title||"",160)});
    if(out.length>=12)break;
  }
  return out;
}
const AI_GEMINI_CATALOG_TTL_MS=6*60*60*1000;
const AI_GEMINI_EMERGENCY_MODELS=[
  "gemini-3.8-flash","gemini-3.7-flash","gemini-3.6-flash","gemini-3.5-flash","gemini-3-flash",
  "gemini-3.5-flash-lite","gemini-3.1-flash-lite"
];
const aiGeminiCatalogCache=new Map();
function aiGeminiStableFlashMeta(value){
  const id=String(value||"").replace(/^models\//,"").toLowerCase();
  const m=id.match(/^gemini-(\d+)(?:\.(\d+))?(?:\.(\d+))?-flash(-lite)?$/);
  if(!m)return null;
  return{id,major:Number(m[1]||0),minor:Number(m[2]||0),patch:Number(m[3]||0),lite:!!m[4]};
}
function aiGeminiSortModels(values){
  const seen=new Set(),rows=[];
  for(const value of values||[]){
    const meta=aiGeminiStableFlashMeta(value);
    if(!meta||seen.has(meta.id))continue;
    seen.add(meta.id);rows.push(meta);
  }
  rows.sort((a,b)=>(Number(a.lite)-Number(b.lite))||(b.major-a.major)||(b.minor-a.minor)||(b.patch-a.patch)||a.id.localeCompare(b.id));
  return rows.map(x=>x.id);
}
async function aiGeminiCatalogKey(apiKey){
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(apiKey||"")));
  return [...new Uint8Array(hash).slice(0,12)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function aiGeminiModelChain(apiKey,configuredModel=""){
  const key=await aiGeminiCatalogKey(apiKey),cached=aiGeminiCatalogCache.get(key),now=Date.now();
  if(cached&&now-cached.at<AI_GEMINI_CATALOG_TTL_MS)return{models:cached.models,source:"catalog-cache"};
  try{
    const res=await aiFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",{headers:{"x-goog-api-key":apiKey}},15000);
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(aiProviderError("gemini",res.status,data));
    const available=[];
    for(const row of data.models||[]){
      const id=String(row&&row.name||"").replace(/^models\//,""),meta=aiGeminiStableFlashMeta(id);
      if(!meta)continue;
      const actions=Array.isArray(row.supportedGenerationMethods)?row.supportedGenerationMethods:
        Array.isArray(row.supportedActions)?row.supportedActions:[];
      if(actions.length&&!actions.includes("generateContent"))continue;
      available.push(meta.id);
    }
    const models=aiGeminiSortModels(available);
    if(!models.length)throw new Error("No stable Flash models in Gemini catalog");
    aiGeminiCatalogCache.set(key,{at:now,models});
    if(aiGeminiCatalogCache.size>24){
      const oldest=[...aiGeminiCatalogCache.entries()].sort((x,y)=>x[1].at-y[1].at).slice(0,aiGeminiCatalogCache.size-24);
      for(const [k] of oldest)aiGeminiCatalogCache.delete(k);
    }
    return{models,source:"catalog"};
  }catch(error){
    // Si Google no deja listar modelos, usamos una cadena local conocida. El modelo
    // configurado solo entra si también es un Flash estable; nunca previews/latest/experimental.
    const emergency=aiGeminiSortModels([configuredModel,...AI_GEMINI_EMERGENCY_MODELS]);
    return{models:emergency,source:"emergency",catalogError:String(error&&error.message||error)};
  }
}
async function aiAskGemini(apiKey,model,prompt){
  // ViewInvAI ya adjunta cotización, técnica y noticias/eventos conocidos. El backend
  // descubre automáticamente todos los Flash estables disponibles para esta API key,
  // prueba primero los normales del más nuevo al más antiguo y después los Flash-Lite.
  const chain=await aiGeminiModelChain(apiKey,model),models=chain.models;
  const system=AI_CONTRAST_SYSTEM+
    "\nIMPORTANTE: no tienes búsqueda web en esta consulta. Usa los datos actuales aportados por ViewInvAI en el prompt. No afirmes haber verificado fuera de ellos; si falta un dato reciente, indícalo y usa «dudas».";
  const body=JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:"user",parts:[{text:prompt}]}]});
  let last=null,usedModel="",index=-1;
  for(let i=0;i<models.length;i++){
    const candidate=models[i];usedModel=candidate;index=i;
    // Un 503/5xx/429 puede ser transitorio o específico de un modelo: reintento corto y,
    // si persiste, seguimos exactamente con el siguiente modelo del catálogo ordenado.
    for(let attemptNo=0;attemptNo<2;attemptNo++){
      const endpoint="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(candidate)+":generateContent";
      const res=await aiFetch(endpoint,{method:"POST",headers:{"x-goog-api-key":apiKey,"Content-Type":"application/json"},body});
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        const cand=data.candidates&&data.candidates[0]||{};
        const text=(cand.content&&cand.content.parts||[]).map(p=>p&&p.text||"").join("");
        const chunks=cand.groundingMetadata&&cand.groundingMetadata.groundingChunks||[];
        return{text,sources:chunks.map(c=>c&&c.web?{url:c.web.uri,title:c.web.title}:null).filter(Boolean),
          freeFallback:true,modelFallback:i>0?candidate:"",effectiveModel:candidate,modelCatalogSource:chain.source};
      }
      last={res,data};
      const transient=[429,500,502,503,504].includes(res.status);
      if(!transient)break;
      if(attemptNo===0)await new Promise(resolve=>setTimeout(resolve,450));
    }
    if(last&&[401,403].includes(last.res.status))break;
  }
  return{error:aiProviderError("gemini",last&&last.res?last.res.status:503,last&&last.data||{}),effectiveModel:usedModel,modelIndex:index,modelCatalogSource:chain.source};
}
async function aiAskClaude(apiKey,model,prompt){
  const messages=[{role:"user",content:prompt}];
  let text="",sources=[];
  // Con búsqueda web en el servidor la respuesta puede pausarse (pause_turn): se continúa
  // devolviendo el contenido tal cual, como máximo dos veces.
  for(let round=0;round<3;round++){
    const res=await aiFetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-beta":"server-side-fallback-2026-07-01","content-type":"application/json"},
      body:JSON.stringify({model,max_tokens:8000,system:AI_CONTRAST_SYSTEM,output_config:{effort:"low"},fallbacks:"default",
        tools:[{type:"web_search_20260209",name:"web_search",max_uses:4}],messages})
    },120000);
    const data=await res.json().catch(()=>({}));
    if(!res.ok)return{error:aiProviderError("anthropic",res.status,data)};
    if(data.stop_reason==="refusal")return{error:"Claude no ha querido responder a esta consulta."};
    for(const block of data.content||[]){
      if(block.type==="text"){
        text+=block.text||"";
        for(const c of block.citations||[])if(c&&c.url)sources.push({url:c.url,title:c.title});
      }else if(block.type==="web_search_tool_result"&&Array.isArray(block.content)){
        for(const r of block.content)if(r&&r.url)sources.push({url:r.url,title:r.title});
      }
    }
    if(data.stop_reason!=="pause_turn")break;
    messages.push({role:"assistant",content:data.content});
  }
  return{text,sources};
}
async function aiAskOpenAi(apiKey,model,prompt){
  const res=await aiFetch("https://api.openai.com/v1/responses",{
    method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({model,instructions:AI_CONTRAST_SYSTEM,input:prompt,tools:[{type:"web_search"}]})
  },120000);
  const data=await res.json().catch(()=>({}));
  if(!res.ok)return{error:aiProviderError("openai",res.status,data)};
  let text="";const sources=[];
  for(const item of data.output||[]){
    if(item.type!=="message")continue;
    for(const part of item.content||[]){
      if(part.type!=="output_text")continue;
      text+=part.text||"";
      for(const a of part.annotations||[])if(a&&a.type==="url_citation")sources.push({url:a.url,title:a.title});
    }
  }
  return{text,sources};
}
function aiContrastRow(row){
  let items=[],sources=[];
  try{items=JSON.parse(row.items_json||"[]")}catch(_){}
  try{sources=JSON.parse(row.sources_json||"[]")}catch(_){}
  return{id:row.id,subjectType:row.subject_type,subjectKey:row.subject_key,day:row.day,provider:row.provider,verdict:row.verdict,summary:row.summary,items,sources,createdAt:row.created_at};
}
async function aiSaveContrast(env,user,subjectType,subjectKey,provider,parsed,sources){
  const row={id:uid("aic_"),user_id:user.id,subject_type:subjectType,subject_key:subjectKey,day:nowIso().slice(0,10),provider,
    verdict:AI_VERDICTS.has(parsed.verdict)?parsed.verdict:"nota",summary:trimText(parsed.summary,800),
    items_json:JSON.stringify(parsed.items||[]),sources_json:JSON.stringify(aiCleanSources(sources)),created_at:nowIso()};
  await env.DB.prepare("INSERT INTO ai_contrasts (id,user_id,subject_type,subject_key,day,provider,verdict,summary,items_json,sources_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(row.id,row.user_id,row.subject_type,row.subject_key,row.day,row.provider,row.verdict,row.summary,row.items_json,row.sources_json,row.created_at).run();
  // Se guardan las 60 últimas por usuario: es una ayuda puntual, no un histórico.
  await env.DB.prepare("DELETE FROM ai_contrasts WHERE user_id=? AND id NOT IN (SELECT id FROM ai_contrasts WHERE user_id=? ORDER BY created_at DESC LIMIT 60)").bind(user.id,user.id).run();
  return aiContrastRow(row);
}
async function handleAiIntegration(request,env,user,json,parts,url){
  await ensureAiIntegrationSchema(env);
  const section=parts[1]||"",noStore={"Cache-Control":"no-store"};
  if(section==="keys"){
    if(request.method==="GET"){
      const {results}=await env.DB.prepare("SELECT provider,last4,model,active,updated_at FROM user_ai_keys WHERE user_id=?").bind(user.id).all();
      const providers={};
      for(const r of results||[])providers[r.provider]={last4:r.last4,model:r.model||AI_PROVIDERS[r.provider]?.model||"",active:!!r.active,updatedAt:r.updated_at};
      return json({serverReady:!!(await aiCryptoKey(env)),providers,defaults:Object.fromEntries(Object.entries(AI_PROVIDERS).map(([k,v])=>[k,v.model]))},200,noStore);
    }
    const provider=aiProviderOf(parts[2]);
    if(request.method==="DELETE"){
      if(!provider)return json({error:"Proveedor no válido"},400);
      await env.DB.prepare("DELETE FROM user_ai_keys WHERE user_id=? AND provider=?").bind(user.id,provider).run();
      return json({ok:true},200,noStore);
    }
    if(request.method==="PATCH"){
      // Varias IA pueden estar activas a la vez: cada una contrasta por su cuenta.
      const body=await readJson(request),target=aiProviderOf(provider||body.provider);
      if(!target)return json({error:"Proveedor no válido"},400);
      const exists=await env.DB.prepare("SELECT 1 FROM user_ai_keys WHERE user_id=? AND provider=?").bind(user.id,target).first();
      if(!exists)return json({error:"Primero conecta esa IA"},404);
      const enabled=body.enabled!==false,model=aiValidModel(body.model);
      await env.DB.prepare("UPDATE user_ai_keys SET active=?,model=CASE WHEN ?<>'' THEN ? ELSE model END,updated_at=? WHERE user_id=? AND provider=?").bind(enabled?1:0,model,model,nowIso(),user.id,target).run();
      return json({ok:true,provider:target,enabled},200,noStore);
    }
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    if(!(await aiCryptoKey(env)))return json({error:"El servidor aún no tiene configurado el cifrado de claves (AI_KEYS_SECRET). Avisa al administrador."},503);
    const body=await readJson(request),p=aiProviderOf(body.provider),apiKey=String(body.key||"").trim();
    if(!p)return json({error:"Proveedor no válido"},400);
    if(apiKey.length<20||apiKey.length>300||/\s/.test(apiKey))return json({error:"La clave no tiene un formato válido. Cópiala entera, sin espacios."},400);
    const model=aiValidModel(body.model)||AI_PROVIDERS[p].model;
    const test=await aiTestKey(p,apiKey);
    if(!test.ok)return json({error:test.error},400);
    const sealed=await aiEncrypt(env,user.id,p,apiKey),now=nowIso();
    await env.DB.prepare(
      "INSERT INTO user_ai_keys (user_id,provider,key_enc,iv,last4,model,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) "+
      "ON CONFLICT(user_id,provider) DO UPDATE SET key_enc=excluded.key_enc,iv=excluded.iv,last4=excluded.last4,model=excluded.model,active=1,updated_at=excluded.updated_at"
    ).bind(user.id,p,sealed.enc,sealed.iv,apiKey.slice(-4),model,1,now,now).run();
    return json({ok:true,provider:p,last4:apiKey.slice(-4),model},200,noStore);
  }
  if(section==="contrast"){
    if(request.method==="GET"){
      // Opiniones de los últimos 3 días (todas): la app las usa para reforzar o rebajar cada acción.
      if(url.searchParams.get("recent")==="1"){
        const since=new Date(Date.now()-3*86400000).toISOString();
        const {results}=await env.DB.prepare("SELECT * FROM ai_contrasts WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 60").bind(user.id,since).all();
        return json({contrasts:(results||[]).map(aiContrastRow)},200,noStore);
      }
      const type=String(url.searchParams.get("type")||"");
      if(!AI_SUBJECT_TYPES.has(type))return json({error:"Tipo no válido"},400);
      const key=trimText(url.searchParams.get("key"),120);
      const stmt=key
        ?env.DB.prepare("SELECT * FROM ai_contrasts WHERE user_id=? AND subject_type=? AND subject_key=? ORDER BY created_at DESC LIMIT 5").bind(user.id,type,key)
        :env.DB.prepare("SELECT * FROM ai_contrasts WHERE user_id=? AND subject_type=? ORDER BY created_at DESC LIMIT 10").bind(user.id,type);
      const {results}=await stmt.all();
      return json({contrasts:(results||[]).map(aiContrastRow)},200,noStore);
    }
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    const body=await readJson(request),type=String(body.subjectType||""),key=trimText(body.subjectKey,120),prompt=trimText(body.prompt,12000);
    if(!AI_SUBJECT_TYPES.has(type)||!key)return json({error:"Falta qué contrastar"},400);
    if(parts[2]==="manual"){
      // Respuesta pegada desde ChatGPT o Claude (suscripción): se guarda como opinión.
      const answer=trimText(body.answer,16000),source=body.source==="claude"?"claude-web":body.source==="gemini"?"gemini-web":"chatgpt-web";
      if(answer.length<20)return json({error:"Pega la respuesta completa de la IA"},400);
      const urls=(answer.match(/https:\/\/[^\s)\]>"']+/g)||[]).map(u=>({url:u.replace(/[.,;]+$/,""),title:""}));
      const parsed=aiParseAnswer(answer),ticker=trimText(body.ticker,24).toUpperCase();
      // En la ficha de una acción, el veredicto general es el de esa acción.
      if(type==="stock"&&ticker&&!parsed.items.length&&parsed.verdict!=="nota")parsed.items=[{ticker,verdict:parsed.verdict,reason:trimText(parsed.summary,400)}];
      const saved=await aiSaveContrast(env,user,type,key,source,parsed,urls);
      return json({contrast:saved},200,noStore);
    }
    if(!prompt)return json({error:"Falta el contenido a contrastar"},400);
    const today=nowIso().slice(0,10),wanted=aiProviderOf(body.provider);
    const {results:keyRows}=wanted
      ?await env.DB.prepare("SELECT * FROM user_ai_keys WHERE user_id=? AND provider=?").bind(user.id,wanted).all()
      :await env.DB.prepare("SELECT * FROM user_ai_keys WHERE user_id=? AND active=1").bind(user.id).all();
    if(!keyRows||!keyRows.length)return json({error:"Activa primero una IA en Configuración › Integrar la IA.",needsSetup:true},409);
    const contrasts=[],errors=[];
    // Contraste automático: si esa IA ya analizó hoy lo mismo, se reutiliza (no gasta cuota).
    const pending=[];
    for(const row of keyRows){
      if(body.force!==true){
        const cached=await env.DB.prepare("SELECT * FROM ai_contrasts WHERE user_id=? AND subject_type=? AND subject_key=? AND day=? AND provider=? ORDER BY created_at DESC LIMIT 1").bind(user.id,type,key,today,row.provider).first();
        if(cached){contrasts.push(aiContrastRow(cached));continue}
      }
      pending.push(row);
    }
    if(pending.length){
      const used=await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_contrasts WHERE user_id=? AND day=? AND provider IN ('gemini','anthropic','openai')").bind(user.id,today).first();
      const cap=type==="radar"?AI_CONTRAST_DAILY_LIMIT-AI_GOAL_RESERVE:AI_CONTRAST_DAILY_LIMIT;
      if((Number(used&&used.n)||0)+pending.length>cap)return json({contrasts,errors:[{provider:"",error:type==="radar"
        ?"Por hoy, la cuota de IA queda reservada para el Objetivo de la cartera. Puedes preguntar a la IA con tu cuenta (gratis) con los logos de arriba."
        :"Has llegado al máximo de "+AI_CONTRAST_DAILY_LIMIT+" análisis con IA por hoy."}]},200,noStore);
      const answers=await Promise.all(pending.map(async row=>{
        const label=AI_PROVIDERS[row.provider].label,apiKey=await aiDecrypt(env,user.id,row.provider,row);
        if(!apiKey)return{row,error:"No se pudo leer tu clave de "+label+". Vuelve a introducirla en Configuración › Integrar la IA."};
        const model=row.model||AI_PROVIDERS[row.provider].model;
        try{
          const a=row.provider==="gemini"?await aiAskGemini(apiKey,model,prompt):row.provider==="anthropic"?await aiAskClaude(apiKey,model,prompt):await aiAskOpenAi(apiKey,model,prompt);
          if(!a.error&&!String(a.text||"").trim())a.error=label+" no ha devuelto respuesta.";
          return{row,...a};
        }catch(error){
          return{row,error:String(error&&error.name)==="AbortError"?label+" ha tardado demasiado. Inténtalo de nuevo.":"No se pudo contactar con "+label+"."};
        }
      }));
      for(const a of answers){
        if(a.error){errors.push({provider:a.row.provider,error:a.error});continue}
        const parsed=aiParseAnswer(a.text);
        if(a.freeFallback)parsed.summary=trimText("Gemini gratis · "+(a.effectiveModel||"Flash")+(a.modelFallback?" (respaldo)":"")+" · sin búsqueda web. "+(parsed.summary||""),800);
        contrasts.push(await aiSaveContrast(env,user,type,key,a.row.provider,parsed,a.sources));
      }
    }
    return json({contrasts,errors},200,noStore);
  }
  return json({error:"Unknown backend endpoint"},404);
}

async function cleanupOldBackendData(env) {
  if (!env.DB) return;
  const now = Date.now();
  const analysisCutoff = new Date(now - 90 * 86400000).toISOString();
  const alertsCutoff = new Date(now - 180 * 86400000).toISOString();
  const devicesCutoff = new Date(now - 90 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM analysis_snapshots WHERE created_at<?").bind(analysisCutoff),
    env.DB.prepare("DELETE FROM alert_events WHERE read_at IS NOT NULL AND created_at<?").bind(alertsCutoff),
    env.DB.prepare("DELETE FROM devices WHERE enabled=0 AND updated_at<?").bind(devicesCutoff)
  ]);
}

// Recordatorio la víspera: a partir de las 17:00 (Madrid), un aviso por cada
// catalizador programado para mañana (resultados, FDA, ensayos) de tus posiciones y
// favoritos. Se respeta el ajuste global «Catalizadores mañana» y el interruptor de
// noticias de cada valor si lo has apagado expresamente.
const CATALYST_EVE_TYPES=new Set(["earnings","medical","regulatory","corporate","event"]);
function madridDay(ms){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(ms));
}
function madridHour(ms){
  return Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Madrid",hour:"2-digit",hour12:false}).format(new Date(ms)))%24;
}
async function scanCatalystEve(env,services,positionRows=[],watchRows=[]){
  const nowMs=Date.now();
  if(madridHour(nowMs)<17||!services.loadMarketSnapshot)return{processed:0,alerts:0};
  const tomorrow=madridDay(nowMs+864e5);
  const snapshot=await services.loadMarketSnapshot(env);
  const events=(snapshot&&Array.isArray(snapshot.events)?snapshot.events:[]).filter(e=>
    e&&e.eventKind!=="news"&&CATALYST_EVE_TYPES.has(String(e.type||""))&&e.date&&madridDay(new Date(e.date).getTime())===tomorrow
  );
  if(!events.length)return{processed:0,alerts:0};
  const byTicker=new Map();
  for(const e of events){const t=String(e.ticker||"").toUpperCase();if(!byTicker.has(t))byTicker.set(t,[]);byTicker.get(t).push(e)}
  const seen=new Set(),globalByUser=new Map();
  let processed=0,alerts=0;
  for(const target of [...(positionRows||[]),...(watchRows||[])]){
    if(!target||!target.user_id||!target.stock_key)continue;
    const key=target.user_id+"|"+String(target.stock_key).toUpperCase();
    if(seen.has(key))continue;seen.add(key);
    const stock=findStock(snapshot,target);
    const list=stock&&byTicker.get(String(stock.ticker||"").toUpperCase());
    if(!list||!list.length)continue;
    try{
      let global=globalByUser.get(target.user_id);
      if(!global){global=await globalNotificationSettingsForUser(env,target.user_id);globalByUser.set(target.user_id,global)}
      if(!global.enabled||!global.catalystEve)continue;
      const pref=await notificationPreferenceForTarget(env,target);
      if(pref&&Number(pref.news_enabled)===0)continue;
      processed++;
      const labels=[...new Set(list.map(e=>e.type==="earnings"?"resultados":e.type==="medical"?(String(e.sourceFamily||"")==="clinicaltrials"?"fecha de un ensayo clínico":"evento clínico / FDA"):e.type==="regulatory"?"decisión regulatoria":"evento corporativo"))];
      const message=tomorrow+" · Mañana: "+labels.join(" y ")+" de "+String(stock.name||target.ticker||"").replace(/\.+$/,"")+". "+trimText(list[0].title||list[0].fact||"",200);
      const duplicate=await env.DB.prepare("SELECT id FROM alert_events WHERE user_id=? AND stock_key=? AND alert_type='catalyst-eve' AND message=? LIMIT 1").bind(target.user_id,target.stock_key,message).first();
      if(duplicate)continue;
      const id=uid("al_"),title="Mañana · "+(target.ticker||stock.ticker),now=nowIso();
      const severity=list.some(e=>e.type==="earnings"||(finiteNumber(e.impactScore)||0)>=65)?"warning":"info";
      await env.DB.prepare(
        "INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,snapshot_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(id,target.user_id,target.stock_key,target.ticker||stock.ticker||"",stock.name||target.name||"","catalyst-eve",severity,title,message,null,now).run();
      try{await dispatchPushAlert(env,{id,alert_type:"catalyst-eve",severity,title,message},target)}
      catch(error){console.warn("Catalyst push dispatch failed",String(error&&error.message||error))}
      alerts++;
    }catch(error){console.warn("Catalyst eve scan failed",target&&target.subject_id,String(error&&error.message||error))}
  }
  return{processed,alerts};
}

async function scanTrackedNewsAndEvents(env,services,positionRows=[],watchRows=[]){
  if(!services.loadMarketSnapshot||(!services.loadNews&&!services.loadOfficialEvents))return{processed:0,alerts:0};
  const raw=[...(positionRows||[]),...(watchRows||[])],seen=new Set(),tracked=[];
  for(const row of raw){
    const key=[String(row&&row.user_id||""),String(row&&row.stock_key||""),Number(row&&row.prefer_tr)===1?"1":"0"].join("|");
    if(!row||!row.user_id||!row.stock_key||seen.has(key))continue;
    seen.add(key);tracked.push(row);
  }
  const snapshot=await services.loadMarketSnapshot(env),globalByUser=new Map();
  let processed=0,alerts=0;
  for(const target of tracked.slice(0,60)){
    try{
      let global=globalByUser.get(target.user_id);
      if(!global){global=await globalNotificationSettingsForUser(env,target.user_id);globalByUser.set(target.user_id,global)}
      if(!global.enabled||!global.newsEvents)continue;
      const assetPreference=await notificationPreferenceForTarget(env,target);
      if(!notificationPreferenceAllows(assetPreference,"news_enabled",false))continue;
      const stock=findStock(snapshot,target);if(!stock)continue;
      const [officialResult,newsResult]=await Promise.allSettled([
        services.loadOfficialEvents?services.loadOfficialEvents(stock,target):Promise.resolve([]),
        services.loadNews?services.loadNews(stock,target):Promise.resolve([])
      ]);
      const official=officialResult.status==="fulfilled"?officialResult.value:[],news=newsResult.status==="fulfilled"?newsResult.value:[];
      const events=mergeEventRows(mergeEventRows(recentEvents(snapshot,stock,18),official,24),news,24);
      const newsIds=await maybeCreateNewsAlerts(env,target,stock,events,null);
      const eventIds=await maybeCreateEventAlerts(env,target,stock,events,null);
      processed++;alerts+=newsIds.length+eventIds.length;
    }catch(error){
      console.warn("Tracked news/event scan failed",target&&target.subject_id,String(error&&error.message||error));
    }
  }
  return{processed,alerts};
}


let portfolioGoalNotificationStateReady=false;
async function ensurePortfolioGoalNotificationStateSchema(env){
  if(portfolioGoalNotificationStateReady)return;
  await ensureGlobalNotificationSettingsSchema(env);
  await ensurePortfolioGoalSchema(env);
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS portfolio_goal_notification_state ("+
    "portfolio_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,signature TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,"+
    "FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  for(const column of ["review_day TEXT NOT NULL DEFAULT ''","candidates TEXT NOT NULL DEFAULT '[]'","risk_signature TEXT NOT NULL DEFAULT ''","plan_json TEXT NOT NULL DEFAULT '{}'","notified TEXT NOT NULL DEFAULT ''"]){
    try{await env.DB.prepare("ALTER TABLE portfolio_goal_notification_state ADD COLUMN "+column).run()}
    catch(error){if(!/duplicate column/i.test(String(error&&error.message||error)))throw error}
  }
  portfolioGoalNotificationStateReady=true;
}
function goalServerKey(stock){
  return trimText(stock&&stock.tvSymbol||((stock&&stock.exchange||"")+":"+(stock&&stock.ticker||"")),120).toUpperCase();
}
function goalServerAllowed(stock,scope){
  if(scope==="tr")return stock&&(stock.tradeRepublicTradable===true||(stock.tradeRepublicVerified&&stock.trTicker));
  return stock&&["NASDAQ","NYSE","AMEX","NYSE ARCA","NYSEARCA"].includes(String(stock.exchange||"").toUpperCase());
}
function goalServerUsdToEur(snapshot){
  const eurUsd=finiteNumber(snapshot&&snapshot.meta&&snapshot.meta.eurUsd);
  return eurUsd&&eurUsd>0?1/eurUsd:null;
}
function goalServerPriceEur(stock,preferTr,usdToEur,side="LAST"){
  if(!stock)return null;
  if(preferTr){
    const eur=finiteNumber(stock.trLivePrice);
    return eur;
  }
  const direction=String(side||"LAST").toUpperCase();
  const usd=direction==="BUY"
    ?finiteNumber(stock.usLiveAsk)
    :direction==="SELL"
      ?finiteNumber(stock.usLiveBid)
      :finiteNumber(stock.usLivePrice);
  return usd!==null&&usdToEur!==null?usd*usdToEur:null;
}
const GOAL_NY_PARTS=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
// The goal plan is reviewed once per real US trading day, 15-60 minutes after the close
// (exchange holidays and early closes come from the shared market-session calendar).
function goalServerReviewClock(now=Date.now()){
  const parts=Object.fromEntries(GOAL_NY_PARTS.formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const minutes=Number(parts.hour)*60+Number(parts.minute);
  const calendarApi=globalThis.ViewInvAIMarketSession;
  const calendar=calendarApi&&typeof calendarApi.usMarketCalendar==="function"
    ?calendarApi.usMarketCalendar(parts)
    :{open:!["Sat","Sun"].includes(parts.weekday),earlyClose:false};
  const close=calendar.earlyClose?13*60:16*60;
  return{day:parts.year+"-"+parts.month+"-"+parts.day,inWindow:!!calendar.open&&minutes>=close+15&&minutes<close+60};
}
let goalRadarCache={at:0,rows:null};
const goalWorkersScoutCache=new Map();
function goalRadarRows(snapshot){
  const stamp=String(snapshot&&snapshot.meta&&(snapshot.meta.liveUpdatedAt||snapshot.meta.updatedAt)||"");
  if(goalRadarCache.rows&&goalRadarCache.stamp===stamp&&Date.now()-goalRadarCache.at<10*60000)return goalRadarCache.rows;
  const rows=radarSignalsForSnapshot(snapshot);
  goalRadarCache={at:Date.now(),stamp,rows};
  return rows;
}
let goalDiscoveryCache={stamp:"",scope:"",at:0,rows:[]};
function goalDiscoveryRows(snapshot,scope){
  const stamp=String(snapshot&&snapshot.meta&&(snapshot.meta.liveUpdatedAt||snapshot.meta.updatedAt)||"");
  if(goalDiscoveryCache.stamp===stamp&&goalDiscoveryCache.scope===scope&&Date.now()-goalDiscoveryCache.at<10*60000)return goalDiscoveryCache.rows;
  const engine=globalThis.ViewInvAIScore,goalEngine=globalThis.ViewInvAIGoal;
  if(!engine||!goalEngine||!Array.isArray(snapshot&&snapshot.stocks))return goalRadarRows(snapshot);
  const byTicker=new Map();
  for(const e of Array.isArray(snapshot.events)?snapshot.events:[]){
    const t=String(e&&e.ticker||"").toUpperCase();if(!t)continue;
    if(!byTicker.has(t))byTicker.set(t,[]);byTicker.get(t).push(e);
  }
  const snapshotAt=Date.parse(snapshot.meta&&(snapshot.meta.liveUpdatedAt||snapshot.meta.updatedAt))||null,nowMs=Date.now(),rows=[];
  for(const stock of snapshot.stocks){
    if(!goalServerAllowed(stock,scope))continue;
    const price=finiteNumber(stock.price);if(!(price>0))continue;
    const events=byTicker.get(String(stock.ticker||"").toUpperCase())||[];
    const a=engine.analyze({price,change:finiteNumber(stock.changePct),volume:finiteNumber(stock.volume),avgVolume:finiteNumber(stock.avgVolume),
      relVolume:finiteNumber(stock.relVolume),rsi:finiteNumber(stock.rsi),adx:finiteNumber(stock.adx),ema20:finiteNumber(stock.ema20),ema50:finiteNumber(stock.ema50),
      perfWeek:finiteNumber(stock.perfWeek),perfMonth:finiteNumber(stock.perfMonth),spread:null,bid:null,ask:null,quoteAgeMs:null,
      snapshotAgeMs:snapshotAt?Math.max(0,nowMs-snapshotAt):null,chartAvailable:false},events,nowMs);
    const score=finiteNumber(a&&a.score)??0,quality=finiteNumber(a&&a.quality&&a.quality.score)??0;
    if(score<50||quality<45)continue;
    const rt=typeof engine.radarTier==="function"?engine.radarTier({score,quality,price,marketCap:finiteNumber(stock.marketCap),avgVolume:finiteNumber(stock.avgVolume),events,nowMs,market:scope}):{};
    const cat=goalServerCatalyst(snapshot,stock),ema20=finiteNumber(stock.ema20),dayHigh=finiteNumber(stock.usLiveDayHigh??stock.dayHigh);
    const extensionPct=price!==null&&ema20>0?(price/ema20-1)*100:null;
    const nearHighPct=price!==null&&dayHigh>0&&price<=dayHigh?(dayHigh-price)/dayHigh*100:null;
    const prelim={score,quality,relVolume:finiteNumber(stock.relVolume),rsi:finiteNumber(stock.rsi),adx:finiteNumber(stock.adx),ema20,
      ema50:finiteNumber(stock.ema50),technicalPrice:price,avgVolume:finiteNumber(stock.avgVolume),dayChangePct:finiteNumber(scope==="tr"?(stock.trLiveChangePct??stock.changePct):(stock.usLiveChangePct??stock.changePct)),
      perfWeek:finiteNumber(stock.perfWeek),perfMonth:finiteNumber(stock.perfMonth),spreadPct:goalServerSpreadPct(stock,scope==="tr"),
      extensionPct,nearHighPct,catalystDays:cat.days,catalystImpact:cat.impact};
    const early=goalEngine.candidateBurst(prelim,"aggressive");
    rows.push({stock_key:goalServerKey(stock),ticker:String(stock.ticker||stock.trTicker||""),name:String(stock.name||""),tier:rt&&rt.tier?rt.tier:"watch",
      score,quality,price,early_score:early.score,tr_tradable:stock.tradeRepublicTradable===true?1:0,speculative:rt&&rt.tier==="spec"?1:0,early_pool:rt&&rt.tier?0:1});
  }
  rows.sort((a,b)=>(b.early_score||0)-(a.early_score||0)||b.score-a.score||b.quality-a.quality);
  goalDiscoveryCache={stamp,scope,at:Date.now(),rows:rows.slice(0,80)};
  return goalDiscoveryCache.rows;
}
function goalServerSpreadPct(stock,preferTr){
  const bid=finiteNumber(preferTr?(stock&&stock.trLiveBid):(stock&&stock.usLiveBid));
  const ask=finiteNumber(preferTr?(stock&&stock.trLiveAsk):(stock&&stock.usLiveAsk));
  if(!(bid>0)||!(ask>0)||ask<bid)return null;
  return (ask-bid)/((ask+bid)/2)*100;
}
function goalServerCatalyst(snapshot,stock){
  let events=[];try{events=recentEvents(snapshot,stock,14)||[]}catch(_){}
  const now=Date.now(),future=events.filter(e=>{
    const t=Date.parse(e&&e.date||"");return Number.isFinite(t)&&t>=now-3600000&&t<=now+14*86400000;
  }).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||(finiteNumber(b.impactScore)||0)-(finiteNumber(a.impactScore)||0));
  const recentNews=events.filter(e=>e&&e.eventKind==="news"&&Number.isFinite(Date.parse(e.date||""))&&Date.parse(e.date)>=now-72*3600000)
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||(finiteNumber(b.impactScore)||0)-(finiteNumber(a.impactScore)||0));
  const e=future[0]||recentNews[0]||null;if(!e)return{days:null,impact:0,title:""};
  return{days:Math.max(0,(Date.parse(e.date)-now)/86400000),impact:Math.max(0,Math.min(100,finiteNumber(e.impactScore)??50)),title:trimText(e.title||e.fact||"",180)};
}
async function goalWorkersScout(env,goal,candidates){
  const engine=globalThis.ViewInvAIGoal;
  if(!env.AI||typeof env.AI.run!=="function"||!engine||typeof engine.candidateBurst!=="function"||!candidates.length)return{reviewed:false,map:new Map()};
  const ranked=candidates.map(c=>({c,b:engine.candidateBurst(c,goal.risk_profile||"aggressive")}))
    .sort((x,y)=>y.b.score-x.b.score||(finiteNumber(y.c.score)||0)-(finiteNumber(x.c.score)||0)).slice(0,8);
  if(!ranked.length)return{reviewed:false,map:new Map()};
  const signature=goal.portfolio_id+"|"+ranked.map(x=>[
    x.c.ticker,Math.round(x.b.score),Math.round((finiteNumber(x.c.relVolume)||0)*10),Math.round((finiteNumber(x.c.dayChangePct)||0)*10),
    Math.round(finiteNumber(x.c.rsi)||0),Math.round(finiteNumber(x.c.adx)||0),Math.round(finiteNumber(x.c.catalystImpact)||0)
  ].join(":")).join("|");
  const cached=goalWorkersScoutCache.get(signature);
  if(cached&&Date.now()-cached.at<GOAL_SCOUT_CACHE_MS)return{reviewed:true,map:new Map(cached.rows),cached:true,model:GOAL_WORKERS_AI_MODEL};
  const payload=ranked.map(({c,b})=>({ticker:c.ticker,deterministicBurst:b.score,phase:b.phase,score:c.score,quality:c.quality,
    relVolume:c.relVolume,dayChangePct:c.dayChangePct,rsi:c.rsi,adx:c.adx,ema20:c.ema20,ema50:c.ema50,technicalPrice:c.technicalPrice,
    perfWeek:c.perfWeek,perfMonth:c.perfMonth,spreadPct:c.spreadPct,extensionPct:c.extensionPct,nearHighPct:c.nearHighPct,
    marketCap:finiteNumber(c.stock&&c.stock.marketCap),avgVolume:finiteNumber(c.stock&&c.stock.avgVolume),volume:finiteNumber(c.stock&&(c.stock.usLiveVolume??c.stock.volume)),
    catalystDays:c.catalystDays,catalystImpact:c.catalystImpact,catalyst:c.catalystTitle||""}));
  const prompt=[
    "Eres el scout de muy corto plazo de ViewInvAI. Horizonte: 1-5 sesiones. No busques empresas buenas a largo plazo.",
    "Tu objetivo es detectar oportunidades TEMPRANAS con posibilidad de aceleración fuerte, antes de que el movimiento esté agotado.",
    "Usa SOLO los datos suministrados. Premia: volumen relativo despertando, tendencia naciente, RSI con margen, estructura técnica, catalizador cercano y liquidez.",
    "Penaliza: subida ya extendida, RSI recalentado, spread amplio, deterioro de momentum, falta de catalizador y FOMO.",
    "No confundas volatilidad con oportunidad. Si faltan datos, sé conservador.",
    'Devuelve JSON solamente: {"valores":[{"ticker":"XXX","fase":"early|active|late|avoid","score":0,"veredicto":"boost|neutral|block","motivo":"frase breve"}]}',
    JSON.stringify(payload)
  ].join("\n");
  try{
    const result=(await runWorkersAi(env,{prompt,max_tokens:850,temperature:.05},GOAL_WORKERS_AI_MODEL)).result;
    const parsed=extractAiJson(result),rows=[];
    for(const x of parsed&&Array.isArray(parsed.valores)?parsed.valores:[]){
      const ticker=trimText(x&&x.ticker,24).toUpperCase(),phase=String(x&&x.fase||"").toLowerCase(),verdict=String(x&&x.veredicto||"").toLowerCase();
      if(!ticker||!["early","active","late","avoid"].includes(phase)||!["boost","neutral","block"].includes(verdict))continue;
      rows.push([ticker,{score:Math.max(0,Math.min(100,finiteNumber(x.score)??50)),phase,verdict,reason:trimText(x.motivo,220)}]);
    }
    if(rows.length){
      goalWorkersScoutCache.set(signature,{at:Date.now(),rows});
      if(goalWorkersScoutCache.size>30){
        const oldest=[...goalWorkersScoutCache.entries()].sort((a,b)=>a[1].at-b[1].at).slice(0,goalWorkersScoutCache.size-30);
        for(const [k] of oldest)goalWorkersScoutCache.delete(k);
      }
      return{reviewed:true,map:new Map(rows),model:GOAL_WORKERS_AI_MODEL};
    }
  }catch(error){console.warn("Goal Workers AI scout failed",String(error&&error.message||error))}
  return{reviewed:false,map:new Map()};
}
async function goalAiVerdicts(env,userId){
  // Objetivo opera a 1-5 sesiones: una opinión de hace varios días ya puede estar obsoleta.
  try{
    await ensureAiIntegrationSchema(env);
    const since=new Date(Date.now()-12*3600000).toISOString();
    const {results}=await env.DB.prepare("SELECT items_json,created_at FROM ai_contrasts WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 60").bind(userId,since).all();
    const map=new Map();
    for(const r of results||[]){let items=[];try{items=JSON.parse(r.items_json||"[]")}catch(_){}
      for(const i of items){const t=String(i&&i.ticker||"").toUpperCase();if(t&&!map.has(t)&&["respalda","dudas","contradice"].includes(i.verdict))map.set(t,i.verdict)}}
    return map;
  }catch(_){return new Map()}
}
// Antes de proponer compras nuevas, las IA activas del usuario (Gemini gratis primero) las
// contrastan. El Objetivo tiene prioridad en la cuota diaria; el Radar usa lo que sobra.
async function goalAiReviewBuys(env,goal,buys,positions,candidates=[],snapshot=null,services={}){
  if(!buys.length)return{reviewed:false,verdicts:new Map()};
  try{
    await ensureAiIntegrationSchema(env);
    if(!(await aiCryptoKey(env)))return{reviewed:false,verdicts:new Map()};
    const {results:keys}=await env.DB.prepare("SELECT * FROM user_ai_keys WHERE user_id=? AND active=1 ORDER BY CASE provider WHEN 'gemini' THEN 0 ELSE 1 END").bind(goal.user_id).all();
    if(!keys||!keys.length)return{reviewed:false,verdicts:new Map()};
    const today=nowIso().slice(0,10),reviewBucket=Math.floor(Date.now()/(30*60000)),subjectKey=goal.portfolio_id+":buys:"+reviewBucket+":"+buys.map(x=>x.ticker).sort().join(",");
    const cached=await env.DB.prepare("SELECT * FROM ai_contrasts WHERE user_id=? AND subject_type='goal' AND subject_key=? ORDER BY created_at DESC LIMIT 1").bind(goal.user_id,subjectKey).first();
    let rows=cached?[aiContrastRow(cached)]:[];
    if(!rows.length){
      const used=await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_contrasts WHERE user_id=? AND day=? AND provider IN ('gemini','anthropic','openai')").bind(goal.user_id,today).first();
      if((Number(used&&used.n)||0)>=AI_CONTRAST_DAILY_LIMIT)return{reviewed:false,verdicts:new Map()};
      // Objetivo tiene prioridad. Probamos Gemini primero y, si no responde, la siguiente IA
      // que el usuario haya activado. Nunca llamamos varias de pago si la anterior ya respondió.
      const ctxParts=[];
      for(const x of buys){
        const c=candidates.find(v=>v.key===x.key||String(v.ticker||"").toUpperCase()===String(x.ticker||"").toUpperCase()),s=c&&c.stock||{};
        const bits=["ticker "+x.ticker,"score "+(finiteNumber(c&&c.score)??"—")+"/100","calidad "+(finiteNumber(c&&c.quality)??"—")+"/100",
          finiteNumber(c&&c.priceEur)!==null?"precio compra estimado "+finiteNumber(c.priceEur)+" EUR":"",
          finiteNumber(s.relVolume)!==null?"volumen relativo "+finiteNumber(s.relVolume)+"x":"",
          finiteNumber(s.rsi)!==null?"RSI14 "+finiteNumber(s.rsi):"",
          finiteNumber(s.adx)!==null?"ADX14 "+finiteNumber(s.adx):"",
          finiteNumber(s.ema20)!==null?"EMA20 "+finiteNumber(s.ema20):"",
          finiteNumber(s.ema50)!==null?"EMA50 "+finiteNumber(s.ema50):""].filter(Boolean);
        let ev=[];try{ev=recentEvents(snapshot,s,8)}catch(_){ev=[]}
        if(services.loadOfficialEvents&&s&&Object.keys(s).length){
          try{ev=mergeEventRows(ev,await services.loadOfficialEvents(s,{prefer_tr:Number(c&&c.preferTr||goal.market_scope==="tr")?1:0,ticker:s.ticker||s.trTicker||""}),10)}catch(_){}
        }
        if(services.loadNews&&s&&Object.keys(s).length){
          try{ev=mergeEventRows(ev,await services.loadNews(s,{prefer_tr:Number(c&&c.preferTr||goal.market_scope==="tr")?1:0,ticker:s.ticker||s.trTicker||""}),10)}catch(_){}
        }
        const news=(ev||[]).slice(0,4).map(e=>String(e.date||"").slice(0,10)+" · "+(e.eventKind==="news"?"noticia":"evento")+
          (e.official?" oficial":"")+" · "+trimText(e.title||e.fact||"",180)+(e.source?" · fuente "+trimText(e.source,80):""));
        ctxParts.push(bits.join(" · ")+(news.length?"\n  Noticias/eventos conocidos por ViewInvAI: "+news.join(" | "):"\n  Sin noticias/eventos adicionales verificados por ViewInvAI."));
      }
      const ctxRows=ctxParts.join("\n");
      const prompt="Objetivo de cartera de ViewInvAI. Horizonte REAL: 1-5 sesiones, aproximadamente una semana; no es una cartera de medio/largo plazo. Perfil "+(goal.risk_profile||"aggressive")+".\n"+
        "Buscamos movimientos tempranos con posibilidad de aceleración fuerte, pero rechazamos FOMO, spreads malos y valores ya agotados. Una buena empresa lenta NO basta.\n"+
        "Posiciones actuales: "+(positions.map(p=>p.ticker).join(", ")||"ninguna")+".\n"+
        "El motor propone COMPRAR ahora:\n"+buys.map(x=>"- "+x.ticker+" ("+(x.name||"")+") · stop −"+x.stopPct+" % · recorrido previsto +"+x.targetPct+" %"+(x.burstScore?" · score temprano "+x.burstScore+"/100":"")).join("\n")+
        "\n\nDATOS ACTUALES APORTADOS POR VIEWINVAI:\n"+ctxRows+
        "\n\nContrasta prioritariamente con estos datos. Si no tienes búsqueda web disponible o falta una noticia reciente, dilo; no inventes información.";
      let chosen=null,ans=null;
      for(const row of keys){
        const apiKey=await aiDecrypt(env,goal.user_id,row.provider,row);if(!apiKey)continue;
        const model=row.model||AI_PROVIDERS[row.provider].model;
        try{ans=row.provider==="gemini"?await aiAskGemini(apiKey,model,prompt):row.provider==="anthropic"?await aiAskClaude(apiKey,model,prompt):await aiAskOpenAi(apiKey,model,prompt)}
        catch(_){ans={error:"timeout"}}
        if(!ans.error&&String(ans.text||"").trim()){chosen=row;break}
      }
      if(!chosen||!ans||ans.error||!String(ans.text||"").trim())return{reviewed:false,verdicts:new Map()};
      const parsed=aiParseAnswer(ans.text);
      if(ans.freeFallback)parsed.summary=trimText("Gemini gratis · "+(ans.effectiveModel||"Flash")+(ans.modelFallback?" (respaldo)":"")+" · sin búsqueda web. "+(parsed.summary||""),800);
      rows=[await aiSaveContrast(env,{id:goal.user_id},"goal",subjectKey,chosen.provider,parsed,ans.sources)];
    }
    const verdicts=new Map();
    for(const c of rows)for(const i of c.items||[])verdicts.set(String(i.ticker||"").toUpperCase(),i.verdict);
    return{reviewed:true,verdicts,provider:rows[0]&&rows[0].provider};
  }catch(error){
    console.warn("Goal AI review failed",String(error&&error.message||error));
    return{reviewed:false,verdicts:new Map()};
  }
}
function goalPaceText(pc){
  if(!pc)return"";
  if(pc.status==="reached")return"Objetivo alcanzado.";
  if(pc.status==="behind")return"Vas con retraso respecto al ritmo necesario"+(pc.requiredMonthlyPct!==null?" (hace falta +"+Math.round(pc.requiredMonthlyPct*10)/10+" % al mes)":"")+".";
  if(pc.status==="ahead")return"Vas adelantado respecto al ritmo previsto.";
  if(pc.status==="overdue")return"La fecha objetivo ya ha pasado.";
  if(pc.status==="on")return"Vas en plazo.";
  return"";
}
async function scanPortfolioGoalNotifications(env,services){
  const engine=globalThis.ViewInvAIGoal;
  if(!services.loadMarketSnapshot||!engine)return{processed:0,alerts:0};
  await ensurePortfolioGoalNotificationStateSchema(env);
  await ensurePositionBrokerSchema(env);
  const goals=await env.DB.prepare(
    "SELECT g.portfolio_id,g.user_id,g.target_value_eur,g.target_date,g.risk_profile,g.max_positions,g.allow_spec,g.start_value_eur,g.start_date,g.peak_value_eur,g.defensive,g.created_at,"+
    "p.name,p.base_currency,COALESCE(m.market_scope,'auto') AS market_scope,COALESCE(m.cash_balance,0) AS cash_balance,"+
    "CASE WHEN n.opted_in_explicitly=1 AND n.notifications_enabled=1 AND n.portfolio_goal_enabled=1 THEN 1 ELSE 0 END AS notify "+
    "FROM portfolio_goals g JOIN portfolios p ON p.id=g.portfolio_id AND p.user_id=g.user_id "+
    "LEFT JOIN portfolio_market_settings m ON m.portfolio_id=g.portfolio_id AND m.user_id=g.user_id "+
    "LEFT JOIN user_notification_settings n ON n.user_id=g.user_id "+
    "ORDER BY g.updated_at DESC LIMIT 40"
  ).all();
  if(!(goals.results||[]).length)return{processed:0,alerts:0};
  const clock=goalServerReviewClock();
  const snapshot=await services.loadMarketSnapshot(env),stocks=Array.isArray(snapshot&&snapshot.stocks)?snapshot.stocks:[],usdToEur=goalServerUsdToEur(snapshot);
  const byKey=new Map(stocks.map(s=>[goalServerKey(s),s]));
  const radarCacheByScope=new Map();
  const quoteCache=new Map();
  const quoteEur=async(stock,preferTr,side="LAST")=>{
    if(!stock||!services.loadQuote)return null;
    const key=(preferTr?"tr:":"us:")+goalServerKey(stock),cached=quoteCache.get(key);
    let quote=cached&&Date.now()-cached.at<15000?cached.quote:null;
    if(!quote){
      try{
        quote=await services.loadQuote(stock,{prefer_tr:preferTr?1:0,ticker:stock.ticker||stock.trTicker||"",isin:preferTr?(stock.trIsin||stock.isin||""):(stock.usIsin||stock.isin||"")});
        quoteCache.set(key,{at:Date.now(),quote});
      }catch(error){return null}
    }
    const d=String(side).toUpperCase();
    const native=d==="BUY"?finiteNumber(quote&&quote.ask):d==="SELL"?finiteNumber(quote&&quote.bid):finiteNumber(quote&&quote.price);
    if(native===null)return null;
    return preferTr?native:(usdToEur!==null?native*usdToEur:null);
  };
  const atrPct=stock=>{const a=finiteNumber(stock&&stock.atr),p=finiteNumber(stock&&stock.price);return a!==null&&p>0?a/p*100:null};
  const pushGoal=async(goal,{title,message,severity,stockKey="",ticker="",preferTr=0})=>{
    if(Number(goal.notify)!==1)return false;
    const id=uid("al_"),now=nowIso();
    await env.DB.prepare("INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id,goal.user_id,stockKey,trimText(ticker,24),"","portfolio-goal",severity,title,message,now).run();
    await dispatchPushAlert(env,{id,alert_type:"portfolio-goal",severity,title,message},{user_id:goal.user_id,route:"portfolio-goal",portfolio_id:goal.portfolio_id,stock_key:stockKey,ticker,prefer_tr:preferTr});
    return true;
  };
  let processed=0,alerts=0,writes=0;
  for(const goal of goals.results||[]){
    try{
      const positions=(await env.DB.prepare(
        "SELECT p.id,p.stock_key,p.ticker,p.name,p.prefer_tr,p.quantity,p.avg_price,p.currency,p.last_score,p.opened_at,p.frozen_qty,p.frozen_until,"+
        "(SELECT MAX(t.executed_at) FROM transactions t WHERE t.position_id=p.id AND t.user_id=p.user_id AND t.side='BUY') AS last_buy_at "+
        "FROM positions p WHERE p.user_id=? AND p.portfolio_id=? AND p.active=1 ORDER BY p.created_at ASC"
      ).bind(goal.user_id,goal.portfolio_id).all()).results||[];
      let scope=String(goal.market_scope||"auto").toLowerCase();
      if(scope==="auto"&&positions.length){const mk=new Set(positions.map(p=>Number(p.prefer_tr)===1?"tr":"us"));if(mk.size===1)scope=[...mk][0]}
      if(!["tr","us"].includes(scope)){processed++;continue}
      const preferTr=scope==="tr";
      const prev=await env.DB.prepare("SELECT signature,summary,review_day,plan_json,notified,updated_at FROM portfolio_goal_notification_state WHERE portfolio_id=? AND user_id=?").bind(goal.portfolio_id,goal.user_id).first();
      const states=new Map(((await env.DB.prepare("SELECT stock_key,peak_eur,stop_eur FROM portfolio_goal_position_state WHERE user_id=? AND portfolio_id=?").bind(goal.user_id,goal.portfolio_id).all()).results||[]).map(r=>[String(r.stock_key).toUpperCase(),r]));
      const radar=radarCacheByScope.get(scope)||goalDiscoveryRows(snapshot,scope);
      if(!radarCacheByScope.has(scope))radarCacheByScope.set(scope,radar);
      const radarByKey=new Map(radar.map(r=>[r.stock_key,r]));
      const ai=await goalAiVerdicts(env,goal.user_id);
      // Posiciones con precio verificado (sin precio, este minuto no se decide nada).
      const enginePositions=[],lockedKeys=[];let incomplete=false,lockedValueEur=0,lockedHoldings=0;
      // Decisiones «Decidir» vigentes de las posiciones de esta cartera.
      await ensurePositionDecisionsSchema(env);
      const decisionsById=new Map(((await env.DB.prepare("SELECT position_id,decision,hold_mode,hold_pct,target_eur,emergency_eur,hold_until,review_at FROM position_decisions WHERE user_id=? AND subject_type='position'").bind(goal.user_id).all()).results||[])
        .filter(d=>decisionIsCurrent(d)&&(d.decision==="hold"||d.decision==="later")).map(d=>[d.position_id,d]));
      for(const p of positions){
        const key=String(p.stock_key||"").toUpperCase(),stock=byKey.get(key)||findStock(snapshot,p),total=Math.max(0,finiteNumber(p.quantity)??0);
        const frozen=Math.min(total,serverFrozenQty(p));
        const qty=Math.max(0,total-frozen);
        if(!(total>0))continue;
        const ptr=Number(p.prefer_tr)===1,mark=await quoteEur(stock,ptr,"LAST"),bid=await quoteEur(stock,ptr,"SELL");
        if(mark===null){incomplete=true;break}
        if(frozen>0){lockedValueEur+=frozen*mark;lockedKeys.push(key);if(total-frozen<=1e-9)lockedHoldings++}
        if(!(qty>1e-9))continue;
        const avg=finiteNumber(p.avg_price),cur=String(p.currency||(ptr?"EUR":"USD")).toUpperCase();
        const avgEur=avg===null?null:cur==="EUR"?avg:cur==="USD"&&usdToEur!==null?avg*usdToEur:null;
        const st=states.get(key)||{},rr=radarByKey.get(key);
        const ticker=String(stock&&(stock.ticker||stock.trTicker)||p.ticker||"").toUpperCase();
        const openedMs=Date.parse(p.last_buy_at||p.opened_at||""),holdingDays=Number.isFinite(openedMs)?Math.max(0,(Date.now()-openedMs)/86400000):null;
        const cat=goalServerCatalyst(snapshot,stock);
        const dec=decisionsById.get(p.id);
        const hold=dec?{mode:dec.hold_mode||(dec.decision==="hold"?"recover":"date"),pct:finiteNumber(dec.hold_pct),
          targetEur:finiteNumber(dec.target_eur)??(dec.decision==="hold"&&!dec.hold_mode?avgEur:null),emergencyEur:finiteNumber(dec.emergency_eur),until:dec.hold_until||String(dec.review_at||"").slice(0,10)}:null;
        enginePositions.push({hold,positionId:p.id,key,ticker,marketTicker:String(stock&&(ptr?stock.trTicker:stock.ticker)||ticker).toUpperCase(),name:p.name||stock&&stock.name||"",units:qty,avgEur,priceEur:mark,bidEur:bid,score:finiteNumber(p.last_score)??(rr?rr.score:50),
          quality:rr?rr.quality:60,tier:rr?rr.tier:"",speculative:!!(rr&&rr.speculative),atrPct:atrPct(stock),peakEur:finiteNumber(st.peak_eur),stopEur:finiteNumber(st.stop_eur),
          feeEur:ptr?1:1,aiVerdict:ai.get(ticker)||"",preferTr:ptr,holdingDays,catalystDays:cat.days,catalystImpact:cat.impact,
          perfWeek:finiteNumber(stock&&stock.perfWeek),perfMonth:finiteNumber(stock&&stock.perfMonth)});
      }
      if(incomplete){processed++;continue}
      const held=new Set([...enginePositions.map(p=>p.key),...lockedKeys]);
      const candidates=radar.filter(r=>!held.has(r.stock_key)&&(preferTr?r.tr_tradable===1:true)).slice(0,40).map(r=>{
        const stock=byKey.get(r.stock_key);if(!stock||!goalServerAllowed(stock,scope))return null;
        const priceEur=goalServerPriceEur(stock,preferTr,usdToEur,"BUY")??(finiteNumber(stock.price)!==null&&usdToEur!==null?finiteNumber(stock.price)*usdToEur:null);
        const ticker=String(stock.ticker||stock.trTicker||"").toUpperCase(),cat=goalServerCatalyst(snapshot,stock);
        const techPrice=finiteNumber(stock.price),ema20=finiteNumber(stock.ema20),dayHigh=finiteNumber(stock.dayHigh);
        const extensionPct=techPrice!==null&&ema20>0?(techPrice/ema20-1)*100:null;
        const nearHighPct=techPrice!==null&&dayHigh>0&&techPrice<=dayHigh?(dayHigh-techPrice)/dayHigh*100:null;
        // En Trade Republic la variación del día es la de LSX; sin ella no se usa la de NYSE/NASDAQ.
        const dayChangePct=finiteNumber(preferTr?stock.trLiveChangePct:(stock.usLiveChangePct??stock.changePct));
        return priceEur>0?{key:r.stock_key,ticker,marketTicker:String((preferTr?stock.trTicker:stock.ticker)||ticker).toUpperCase(),name:r.name,priceEur,score:r.score,quality:r.quality,tier:r.speculative?"spec":r.tier,speculative:!!r.speculative,atrPct:atrPct(stock),feeEur:1,aiVerdict:ai.get(ticker)||"",stock,
          relVolume:finiteNumber(stock.relVolume),rsi:finiteNumber(stock.rsi),adx:finiteNumber(stock.adx),ema20,ema50:finiteNumber(stock.ema50),technicalPrice:techPrice,avgVolume:finiteNumber(stock.avgVolume),
          dayChangePct,perfWeek:finiteNumber(stock.perfWeek),perfMonth:finiteNumber(stock.perfMonth),spreadPct:goalServerSpreadPct(stock,preferTr),
          extensionPct,nearHighPct,catalystDays:cat.days,catalystImpact:cat.impact,catalystTitle:cat.title}:null;
      }).filter(Boolean);
      let cashEur=Math.max(0,finiteNumber(goal.cash_balance)??0);
      if(String(goal.base_currency||"EUR").toUpperCase()==="USD")cashEur=usdToEur===null?0:cashEur*usdToEur;
      const scout=await goalWorkersScout(env,goal,candidates);
      for(const c of candidates){
        const x=scout.map.get(c.ticker);
        if(x){c.aiScoutScore=x.score;c.aiScoutPhase=x.phase;c.aiScoutVerdict=x.verdict;c.aiScoutReason=x.reason}
      }
      const input={config:{target:finiteNumber(goal.target_value_eur),deadline:goal.target_date?goal.target_date+"T23:59:59Z":"",startValue:finiteNumber(goal.start_value_eur),startDate:goal.start_date||goal.created_at,
          risk:goal.risk_profile,maxPositions:finiteNumber(goal.max_positions)??5,specMode:Math.max(0,Math.min(3,Math.round(finiteNumber(goal.allow_spec)??1))),allowSpec:Number(goal.allow_spec)!==0},
        positions:enginePositions,candidates,cashEur,lockedValueEur,lockedKeys,lockedHoldings,peakValueEur:finiteNumber(goal.peak_value_eur),wasDefensive:Number(goal.defensive)===1};
      let plan=engine.plan(input);
      plan.aiScoutReviewed=scout.reviewed;plan.aiScoutModel=scout.model||"";
      // Compras: precio de compra verificado y contraste de la IA del usuario antes de proponerlas.
      let buys=plan.actions.filter(a=>a.type==="BUY");
      if(buys.length){
        const review=await goalAiReviewBuys(env,goal,buys,enginePositions,candidates,snapshot,services);
        const rejected=new Set([...review.verdicts].filter(([,v])=>v==="contradice").map(([t])=>t));
        for(const c of candidates)if(review.verdicts.has(c.ticker))c.aiVerdict=review.verdicts.get(c.ticker);
        plan.aiReviewed=review.reviewed;plan.aiProvider=review.provider||"";
      }
      // Compras y destinos de cambio: solo con una cotización en vivo verificada ahora y sin estar
      // devolviendo la subida de la apertura. Lo no verificado queda como «Esperar».
      const targets=new Set([...buys.map(b=>b.key),...plan.actions.filter(a=>a.intoKey).map(a=>a.intoKey)]);
      if(targets.size){
        const reviewMeta={aiScoutReviewed:plan.aiScoutReviewed,aiScoutModel:plan.aiScoutModel,aiReviewed:plan.aiReviewed,aiProvider:plan.aiProvider};
        for(const c of candidates){
          c.quoteFresh=false;
          if(!targets.has(c.key))continue;
          const ask=await quoteEur(c.stock,preferTr,"BUY");
          if(ask===null)continue;
          const raw=(quoteCache.get((preferTr?"tr:":"us:")+goalServerKey(c.stock))||{}).quote||{};
          c.askEur=ask;c.quoteFresh=true;
          // La variación del día del mercado donde se opera (LSX en Trade Republic) sale de la cotización verificada.
          if(finiteNumber(raw.changePct)!==null)c.dayChangePct=finiteNumber(raw.changePct);
          c.openFadePct=engine.openFadePct({market:preferTr?"tr":"us",marketStatus:raw.marketStatus,price:raw.price,open:raw.open});
        }
        plan=engine.plan(input);
        Object.assign(plan,reviewMeta);
      }
      // Estado persistente: solo se escribe cuando cambia de verdad.
      const now=nowIso();let automaticWrites=0;
      const nextPeak=finiteNumber(plan.peakValueEur),oldPeak=finiteNumber(goal.peak_value_eur),nextDefensive=plan.defensive?1:0;
      const goalStateChanged=(nextPeak!==oldPeak)||nextDefensive!==Number(goal.defensive)||
        goal.start_value_eur===null||goal.start_value_eur===undefined||!goal.start_date;
      if(goalStateChanged){
        await env.DB.prepare("UPDATE portfolio_goals SET peak_value_eur=?,defensive=?,start_value_eur=COALESCE(start_value_eur,?),start_date=COALESCE(start_date,?) WHERE portfolio_id=? AND user_id=?")
          .bind(nextPeak,nextDefensive,plan.valueEur,now,goal.portfolio_id,goal.user_id).run();
        automaticWrites++;
      }
      for(const p of enginePositions){
        const st=engine.positionStop(p,input.config.risk),old=states.get(String(p.key).toUpperCase());
        const oldP=finiteNumber(old&&old.peak_eur),oldS=finiteNumber(old&&old.stop_eur),newP=finiteNumber(st.peakEur),newS=finiteNumber(st.stopEur);
        if(!old||newP!==oldP||newS!==oldS){
          await env.DB.prepare("INSERT INTO portfolio_goal_position_state (portfolio_id,user_id,stock_key,peak_eur,stop_eur,updated_at) VALUES (?,?,?,?,?,?) "+
            "ON CONFLICT(portfolio_id,stock_key) DO UPDATE SET peak_eur=MAX(COALESCE(peak_eur,0),excluded.peak_eur),stop_eur=MAX(COALESCE(stop_eur,0),excluded.stop_eur),updated_at=excluded.updated_at")
            .bind(goal.portfolio_id,goal.user_id,p.key,newP,newS,now).run();
          automaticWrites++;
        }
      }
      const stale=[...states.keys()].filter(k=>!held.has(k));
      if(stale.length){
        await env.DB.prepare("DELETE FROM portfolio_goal_position_state WHERE user_id=? AND portfolio_id=? AND stock_key IN ("+stale.map(()=>"?").join(",")+")")
          .bind(goal.user_id,goal.portfolio_id,...stale).run();
        automaticWrites+=stale.length;
      }
      // Avisos al momento: cada acción una vez por día (por tipo, valor y nivel).
      let notified={day:"",keys:[]};try{notified=JSON.parse(prev&&prev.notified||"{}")||notified}catch(_){}
      if(notified.day!==clock.day)notified={day:clock.day,keys:[]};
      const seen=new Set(notified.keys||[]),fresh=[];
      const visibleDecisions=[...(plan.actions||[]),...(plan.waits||[])];
      for(const a of visibleDecisions){
        const k=a.type+":"+a.ticker+":"+(a.type==="RAISE_STOP"?a.stopEur:a.type==="BUY"?a.units:a.type==="WAIT"?(a.limitPriceEur||a.decision||"wait"):a.reason||"");
        if(seen.has(k))continue;seen.add(k);fresh.push(a);
      }
      const summaryLine=visibleDecisions.length?visibleDecisions.map(a=>a.text).join(" "):(plan.defensive?plan.notes[0]:"Nada que hacer ahora.");
      const firstRun=!prev;
      if(!firstRun){
        for(const a of fresh.slice(0,4)){
          const sev=a.type==="SELL"?"high":a.type==="BUY"?"high":"info";
          const title=(a.type==="BUY"?"Comprar ahora":a.type==="WAIT"?(a.decision==="COMPRA LÍMITE"?"Compra límite":"Esperar"):a.type==="SELL"?(a.reason==="stop"?"Stop alcanzado":"Vender"):"Subir stop")+" · "+goal.name;
          if(await pushGoal(goal,{title,message:trimText(a.text+(a.type==="BUY"&&plan.aiReviewed?" Contrastado con IA.":""),500),severity:sev,stockKey:a.key,ticker:a.ticker,preferTr:preferTr?1:0}))alerts++;
        }
      }
      let reviewDay=prev?String(prev.review_day||""):"";
      // Resumen diario tras el cierre de EEUU.
      if(clock.inWindow&&reviewDay!==clock.day){
        reviewDay=clock.day;
        const pc=plan.pace||{},progress=pc.progressPct!==null&&pc.progressPct!==undefined?Math.round(pc.progressPct)+" % del camino":"";
        const msg=trimText([progress,goalPaceText(pc),"Hoy: "+summaryLine].filter(Boolean).join(" · "),500);
        if(!firstRun&&await pushGoal(goal,{title:"Resumen del objetivo · "+goal.name,message:msg,severity:"info"}))alerts++;
      }
      const planCore={actions:plan.actions,waits:plan.waits||[],holds:plan.holds,notes:plan.notes,pace:plan.pace,defensive:plan.defensive,drawdownPct:plan.drawdownPct,aiReviewed:!!plan.aiReviewed,aiProvider:plan.aiProvider||""};
      const planJson=JSON.stringify({at:now,...planCore}).slice(0,20000);
      const signature=JSON.stringify(planCore.actions||[]).slice(0,4000),summary=trimText(summaryLine,500),notifiedJson=JSON.stringify({day:notified.day,keys:[...seen].slice(-200)});
      let previousCore="";
      try{const oldPlan=JSON.parse(prev&&prev.plan_json||"{}");delete oldPlan.at;previousCore=JSON.stringify(oldPlan)}catch(_){}
      const stateChanged=!prev||String(prev.signature||"")!==signature||String(prev.summary||"")!==summary||
        String(prev.review_day||"")!==reviewDay||String(prev.notified||"")!==notifiedJson||previousCore!==JSON.stringify(planCore);
      if(stateChanged){
        await env.DB.prepare(
          "INSERT INTO portfolio_goal_notification_state (portfolio_id,user_id,signature,summary,review_day,candidates,risk_signature,plan_json,notified,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) "+
          "ON CONFLICT(portfolio_id) DO UPDATE SET signature=excluded.signature,summary=excluded.summary,review_day=excluded.review_day,plan_json=excluded.plan_json,notified=excluded.notified,updated_at=excluded.updated_at"
        ).bind(goal.portfolio_id,goal.user_id,signature,summary,reviewDay,"[]","",planJson,notifiedJson,now).run();
        automaticWrites++;
      }
      processed++;writes+=automaticWrites;
    }catch(error){
      console.warn("Portfolio goal scan failed",goal.portfolio_id,String(error&&error.message||error));
    }
  }
  return{processed,alerts,writes};
}

export async function runScheduledPortfolioAnalysis(env, services = {}) {
  if (!env.DB || !services.loadMarketSnapshot || !services.loadChart) {
    return { skipped: true, reason: "backend-not-configured" };
  }
  await ensurePortfolioGoalSchema(env);
  await ensurePositionBrokerSchema(env);

  const nowDate = new Date();
  if (nowDate.getUTCHours() === 3 && nowDate.getUTCMinutes() < 5) {
    try { await cleanupOldBackendData(env); }
    catch (error) { console.warn("Backend retention cleanup failed", String(error && error.message || error)); }
  }

  const [positionRows, watchRows] = await Promise.all([
    env.DB.prepare(
      "SELECT 'position' AS subject_type,p.id AS subject_id,p.user_id,p.stock_key,p.ticker,p.name,p.exchange,p.isin,p.prefer_tr,p.quantity,p.avg_price,p.currency,p.frozen_qty,p.frozen_until,p.last_analysis_at,p.last_signal,p.last_confidence,p.last_score,p.last_snapshot_id," +
      "CASE WHEN g.portfolio_id IS NOT NULL THEN 1 ELSE 0 END AS goal_priority,"+
      "CASE WHEN g.portfolio_id IS NOT NULL THEN 5 ELSE COALESCE(s.analysis_positions_minutes,10) END AS analysis_interval_minutes " +
      "FROM positions p LEFT JOIN user_settings s ON s.user_id=p.user_id LEFT JOIN portfolio_goals g ON g.portfolio_id=p.portfolio_id AND g.user_id=p.user_id WHERE p.active=1 " +
      "ORDER BY p.last_analysis_at ASC LIMIT 40"
    ).all(),
    env.DB.prepare(
      "SELECT 'watchlist' AS subject_type,w.id AS subject_id,w.user_id,w.stock_key,w.ticker,w.name,w.exchange,w.isin,w.prefer_tr,NULL AS quantity,NULL AS avg_price,'EUR' AS currency,w.last_analysis_at,w.last_signal,w.last_confidence,w.last_score,w.last_snapshot_id,0 AS goal_priority," +
      "COALESCE(s.analysis_watchlist_minutes,30) AS analysis_interval_minutes " +
      "FROM watchlist w LEFT JOIN user_settings s ON s.user_id=w.user_id " +
      "ORDER BY w.last_analysis_at ASC LIMIT 40"
    ).all()
  ]);

  const nowMs = Date.now(),budget=await automationWriteBudget(env,nowMs);
  const due = row => {
    if (!scheduledAnalysisWindow(row,nowMs)) return false;
    if (!row.last_analysis_at) return true;
    const last = new Date(row.last_analysis_at).getTime();
    const minutes = Math.max(row.subject_type === "position" ? 5 : 10, finiteNumber(row.analysis_interval_minutes) ?? (row.subject_type === "position" ? 10 : 30));
    return !Number.isFinite(last) || nowMs - last >= minutes * 60000;
  };
  const positions = budget.paused?[]:(positionRows.results || []).filter(due);
  const watchlist = budget.paused?[]:(watchRows.results || []).filter(due);
  const queue = [...positions, ...watchlist]
    .sort((a,b) => String(a.last_analysis_at || "").localeCompare(String(b.last_analysis_at || "")))
    .slice(0, 8);
  const results = [];let automaticWrites=0;

  for (const target of queue) {
    try {
      const analysis = await analyzeTarget(env, target, services,{useAi:Number(target.goal_priority)===1});
      automaticWrites+=Number(analysis.automaticWrites)||0;
      results.push({ ok: true, subjectId: target.subject_id, signal: analysis.signal, confidence: analysis.confidence });
    } catch (error) {
      console.warn("Scheduled analysis target failed", target.subject_id, String(error && error.message || error));
      results.push({ ok: false, subjectId: target.subject_id });
    }
  }

  let trackedNews={processed:0,alerts:0},preferences={processed:0},portfolioGoals={processed:0,alerts:0};
  try{trackedNews=await scanTrackedNewsAndEvents(env,services,positionRows.results||[],watchRows.results||[])}
  catch(error){console.warn("Tracked news/event sweep failed",String(error&&error.message||error))}
  let catalystEve={processed:0,alerts:0};
  try{catalystEve=await scanCatalystEve(env,services,positionRows.results||[],watchRows.results||[])}
  catch(error){console.warn("Catalyst eve sweep failed",String(error&&error.message||error))}
  try{preferences=await scanNotificationPreferences(env,services,{allowAi:!budget.paused})}catch(error){console.warn("Notification preference sweep failed",String(error&&error.message||error))}
  try{portfolioGoals=await scanPortfolioGoalNotifications(env,services)}catch(error){console.warn("Portfolio goal notification sweep failed",String(error&&error.message||error))}
  automaticWrites+=(Number(preferences&&preferences.writes)||0)+(Number(portfolioGoals&&portfolioGoals.writes)||0);
  await recordAutomationWrites(env,budget,automaticWrites);
  return { processed: results.length, results, trackedNews, catalystEve, preferences, portfolioGoals, budget:{paused:budget.paused,estimated:budget.estimated,limit:AUTO_WRITE_BUDGET_LIMIT}, automaticWrites };
}
