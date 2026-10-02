import "./score-engine.js";
import "./market-session.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
  { cooldownDuration: 30000, cacheMaxAge: 3600000, timeoutDuration: 5000 }
);

const DEFAULT_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
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

async function verifyFirebaseUser(request, env) {
  if (!env.DB) return { error: "D1 backend not configured", status: 503 };
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) return { error: "Firebase authentication not configured", status: 503 };

  const auth = String(request.headers.get("Authorization") || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: "Authentication required", status: 401 };

  try {
    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      algorithms: ["RS256"],
      issuer: "https://securetoken.google.com/" + projectId,
      audience: projectId,
      clockTolerance: 10
    });

    const userId = trimText(payload.sub, 128);
    const email = trimText(payload.email, 320).toLowerCase();
    if (!userId || !email || payload.email_verified !== true) {
      return { error: "Verified Google/Firebase account required", status: 401 };
    }

    const displayName = trimText(payload.name || payload.display_name || email.split("@")[0], 120);
    const avatarUrl = trimText(payload.picture, 600);
    const now = nowIso();

    await env.DB.prepare(
      "INSERT INTO users (id,email,display_name,avatar_url,auth_provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,avatar_url=excluded.avatar_url,updated_at=excluded.updated_at"
    ).bind(userId, email, displayName, avatarUrl, "firebase-google", now, now).run();

    await env.DB.prepare(
      "INSERT INTO user_settings (user_id,created_at,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING"
    ).bind(userId, now, now).run();

    return {
      user: {
        id: userId,
        email,
        displayName,
        avatarUrl
      }
    };
  } catch (error) {
    console.warn("Firebase token verification failed", String(error && error.message || error));
    return { error: "Invalid or expired authentication token", status: 401 };
  }
}

let positionBrokerSchemaReady=false;
async function ensurePositionBrokerSchema(env){
  if(positionBrokerSchemaReady)return;
  const cols=await env.DB.prepare("PRAGMA table_info(positions)").all();
  const names=new Set((cols.results||[]).map(row=>String(row.name||"")));
  if(!names.has("broker"))await env.DB.prepare("ALTER TABLE positions ADD COLUMN broker TEXT NOT NULL DEFAULT ''").run();
  if(!names.has("cost_basis"))await env.DB.prepare("ALTER TABLE positions ADD COLUMN cost_basis REAL").run();
  if(!names.has("fees_total"))await env.DB.prepare("ALTER TABLE positions ADD COLUMN fees_total REAL NOT NULL DEFAULT 0").run();
  await env.DB.prepare("DROP INDEX IF EXISTS idx_positions_portfolio_stock").run();
  await env.DB.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_portfolio_identity ON positions(portfolio_id,stock_key,broker,currency,prefer_tr,exchange)"
  ).run();
  positionBrokerSchemaReady=true;
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
  const model=trimText(env.AI_MODEL||DEFAULT_AI_MODEL,120)||DEFAULT_AI_MODEL;
  try{
    const identifyPrompt=[
      "Identify the brokerage firm from the supplied name. Return JSON only.",
      "Keys: canonicalName, officialDomain, pricingUrl, plan.",
      "pricingUrl must be an official stock commission page only if confidently known. Otherwise leave it empty. Never invent a domain.",
      JSON.stringify({name:trimText(name,80)})
    ].join("\n");
    const identified=extractAiJson(await env.AI.run(model,{prompt:identifyPrompt,max_tokens:220,temperature:0}))||{};
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
    const fees=extractAiJson(await env.AI.run(model,{prompt:feePrompt,max_tokens:320,temperature:0}))||{};
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

const IMPORT_MAX_ROWS = 80;

// Batch import from a broker export or sync. Rows arrive already matched to the
// catalogue by the app (stockKey/ticker/ISIN) and sorted; each one carries the
// broker's execution id, so re-importing is idempotent.
async function handleTransactionImport(request, env, user, json) {
  const body = await readJson(request);
  const portfolioId = trimText(body.portfolioId, 80);
  const source = ["tr","ibkr","csv"].includes(String(body.source||"")) ? String(body.source) : "csv";
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
  let imported = 0, skipped = 0;
  const errors = [];
  for (const { row } of ordered) {
    const externalId = trimText(row && row.externalId, 120);
    if (!externalId) { errors.push({ externalId: "", error: "Falta el identificador de la operación" }); continue; }
    const existing = await env.DB.prepare("SELECT id FROM transactions WHERE user_id=? AND external_id=? LIMIT 1").bind(user.id, externalId).first();
    if (existing) { skipped++; continue; }
    const data = transactionPayload({ ...row, portfolioId, broker: broker || row.broker, positionId: "" });
    try {
      const result = await createTransactionRecord(env, user, data, {
        origin: "import:" + source, externalId, adjustCash: body.adjustCash === true, defaultFees: 0
      });
      if (result.status >= 400) errors.push({ externalId, ticker: data.ticker, error: String(result.body && result.body.error || "Error") });
      else imported++;
    } catch (error) {
      if (/UNIQUE/i.test(String(error && error.message))) skipped++;
      else errors.push({ externalId, ticker: data.ticker, error: "No se pudo guardar" });
    }
  }
  return json({ imported, skipped, errors });
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
      return json({ trades: parseFlexTrades(xml), positions: parseFlexPositions(xml), fetchedAt: nowIso() });
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
let fxSchemaReady=false;
async function ensureFxSchema(env){
  if(fxSchemaReady)return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fx_rates (currency TEXT NOT NULL,date TEXT NOT NULL,rate REAL NOT NULL CHECK(rate>0),PRIMARY KEY(currency,date))").run();
  fxSchemaReady=true;
}
const isoDay=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):""};
async function loadEcbRates(env,currency,fromDay,toDay){
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
  for(let i=0;i<fresh.length;i+=80){
    await env.DB.batch(fresh.slice(i,i+80).map(r=>env.DB.prepare("INSERT OR REPLACE INTO fx_rates (currency,date,rate) VALUES (?,?,?)").bind(currency,r.date,r.rate)));
  }
  return fresh.length?fresh:rows;
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
  const lookups={};
  for(const [currency,range] of needed){
    if(!/^[A-Z]{3}$/.test(currency))continue;
    const from=new Date(Date.parse(range.from)-12*864e5).toISOString().slice(0,10);
    try{lookups[currency]=fxLookup(await loadEcbRates(env,currency,from,range.to))}catch(_){lookups[currency]=()=>null}
  }
  const report=computeSpanishTax(rows,(c,d)=>lookups[c]?lookups[c](d):null,year);
  report.asOf=year<nowYear?year+"-12-31":isoDay(Date.now());
  report.transactions=rows.length;
  return json(report);
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
let priceDailySchemaReady=false;
async function ensurePriceDailySchema(env){
  if(priceDailySchemaReady)return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS price_daily (key TEXT NOT NULL,date TEXT NOT NULL,close REAL NOT NULL CHECK(close>0),PRIMARY KEY(key,date))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS price_daily_meta (key TEXT PRIMARY KEY,currency TEXT NOT NULL,source TEXT NOT NULL,first_day TEXT NOT NULL DEFAULT '',fetched_at INTEGER NOT NULL)")
  ]);
  priceDailySchemaReady=true;
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
      for(let i=0;i<rows.length;i+=90){
        await env.DB.batch(rows.slice(i,i+90).map(r=>env.DB.prepare("INSERT OR REPLACE INTO price_daily (key,date,close) VALUES (?,?,?)").bind(key,r.date,r.close)));
      }
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
  if(insts.size>60)return json({error:"Demasiados valores para calcular la curva (máximo 60)."},422);
  for(const b of PERF_BENCHMARKS)insts.set("ISIN:"+b.isin,{key:"ISIN:"+b.isin,isin:b.isin,ticker:b.label,benchmark:b.key});
  const prices=new Map(),list=[...insts.values()];
  for(let i=0;i<list.length;i+=4){
    const chunk=list.slice(i,i+4);
    const got=await Promise.all(chunk.map(inst=>loadPriceDaily(env,services,inst,fromDay).catch(()=>({currency:"EUR",rows:[]}))));
    chunk.forEach((inst,j)=>prices.set(inst.key,got[j]));
  }
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
let radarScoreboardSchemaReady=false;
async function ensureRadarScoreboardSchema(env){
  if(radarScoreboardSchemaReady)return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS radar_signals (id TEXT PRIMARY KEY,day TEXT NOT NULL,stock_key TEXT NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',tier TEXT NOT NULL,score REAL NOT NULL,quality REAL NOT NULL,price REAL NOT NULL CHECK(price>0),bench_price REAL,tr_tradable INTEGER NOT NULL DEFAULT 0,speculative INTEGER NOT NULL DEFAULT 0,ret_1d REAL,ret_5d REAL,ret_20d REAL,bench_1d REAL,bench_5d REAL,bench_20d REAL,created_at TEXT NOT NULL,UNIQUE(day,stock_key))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_radar_signals_day ON radar_signals(day)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS radar_bench (day TEXT PRIMARY KEY,price REAL NOT NULL CHECK(price>0),created_at TEXT NOT NULL)")
  ]);
  radarScoreboardSchemaReady=true;
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
    // Same thresholds as the Radar AI screen (alta convicción needs AI validation, not logged here).
    const tier=score>=60&&quality>=48?"opportunity":score>=50&&quality>=40?"watch":"";
    if(!tier)continue;
    const spec=typeof engine.speculative==="function"?engine.speculative({price,marketCap:finiteNumber(s.marketCap),avgVolume:finiteNumber(s.avgVolume),events,nowMs}):{speculative:false};
    rows.push({stock_key:String(s.tvSymbol||((s.exchange||"")+":"+(s.ticker||""))).toUpperCase(),ticker:String(s.ticker||""),name:String(s.name||""),tier,score,quality,price,
      tr_tradable:s.tradeRepublicTradable===true?1:0,speculative:spec.speculative?1:0});
  }
  rows.sort((a,b)=>b.score-a.score||b.quality-a.quality);
  const opp=rows.filter(r=>r.tier==="opportunity").slice(0,60),watch=rows.filter(r=>r.tier==="watch").slice(0,40);
  return[...opp,...watch];
}
export async function runRadarScoreboard(env,services={},nowMs=Date.now()){
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
export async function radarScoreboardSummary(env){
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
    const rows=await stmt.all();return json({plans:rows.results||[]});
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

async function handleFundPositions(request, env, user, json, parts, url) {
  await ensureFundSchema(env);
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const portfolioId = trimText(url.searchParams.get("portfolioId"),80);
    const stmt = portfolioId
      ? env.DB.prepare("SELECT * FROM fund_positions WHERE user_id=? AND fund_portfolio_id=? AND active=1 ORDER BY created_at DESC").bind(user.id,portfolioId)
      : env.DB.prepare("SELECT * FROM fund_positions WHERE user_id=? AND active=1 ORDER BY created_at DESC").bind(user.id);
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

async function handleFundTransactions(request,env,user,json,parts,url){
  await ensureFundSchema(env);
  const id=parts[1]||"";
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
      "SELECT * FROM alert_events WHERE user_id=? ORDER BY created_at DESC LIMIT 100"
    ).bind(user.id).all();
    return json({ alerts: rows.results || [] });
  }

  if (request.method === "POST" && action === "read") {
    const body = await readJson(request);
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
  if (!text) return null;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch (_) { return null; }
}

async function aiAssessment(env, target, stock, chart, events, fallback) {
  if (!env.AI || typeof env.AI.run !== "function") return fallback;
  const model = trimText(env.AI_MODEL || DEFAULT_AI_MODEL, 120) || DEFAULT_AI_MODEL;

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
    const result = await env.AI.run(model, {
      prompt,
      max_tokens: 520,
      temperature: 0.1
    });
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
    if (globalNotifications.radarHigh && current.signal === "BUY" && current.quoteVerified===true && current.confidence >= settings.minBuyConfidence && (!previous || previous.signal !== "BUY")) {
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

  await env.DB.prepare(
    "INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,snapshot_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    id, target.user_id, target.stock_key, target.ticker, stock.name || target.name || "",
    type, severity, title, message, current.snapshotId, now
  ).run();

  const alert = { id, alert_type: type, severity, title, message };
  try { await dispatchPushAlert(env, alert, target); }
  catch (error) { console.warn("Push alert dispatch failed", String(error && error.message || error)); }
  return id;
}

async function analyzeTarget(env, target, services) {
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
  const current = await aiAssessment(env, target, analysisStock, chart, events, fallback);
  current.quoteVerified=quoteVerified;
  current.quoteSource=trimText(verifiedQuote&&verifiedQuote.source,120);
  current.quoteTimestamp=verifiedQuote&&verifiedQuote.timestamp||null;

  const previous = await env.DB.prepare(
    "SELECT signal,confidence,score,engine,created_at FROM analysis_snapshots WHERE user_id=? AND subject_type=? AND subject_id=? ORDER BY created_at DESC LIMIT 1"
  ).bind(target.user_id, target.subject_type, target.subject_id).first();

  const snapshotId = uid("an_");
  const now = nowIso();
  current.snapshotId = snapshotId;

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
      price: quoteVerified ? finiteNumber(verifiedQuote.price) : null,
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

  const table = target.subject_type === "position" ? "positions" : "watchlist";
  await env.DB.prepare(
    "UPDATE " + table + " SET last_analysis_at=?,last_signal=?,last_confidence=?,last_score=?,last_snapshot_id=?,updated_at=? WHERE id=? AND user_id=?"
  ).bind(now, current.signal, current.confidence, current.score, snapshotId, now, target.subject_id, target.user_id).run();

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
    createdAt: now
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
    ["risk_profile","ALTER TABLE portfolio_goals ADD COLUMN risk_profile TEXT NOT NULL DEFAULT 'aggressive'"]
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
  portfolioGoalSchemaReady=true;
}
async function handlePortfolioGoal(request,env,user,json,url){
  await ensurePortfolioGoalSchema(env);
  if(request.method==="GET"){
    await ensurePortfolioGoalNotificationStateSchema(env);
    const portfolioId=trimText(url.searchParams.get("portfolioId"),80);
    if(portfolioId){
      if(!(await onePortfolio(env,user.id,portfolioId)))return json({error:"Portfolio not found"},404);
      const goal=await env.DB.prepare(
        "SELECT g.portfolio_id,g.user_id,g.target_value_eur,g.target_date,g.monthly_contribution_eur,g.risk_profile,g.created_at,g.updated_at,s.review_day,s.candidates AS review_candidates FROM portfolio_goals g LEFT JOIN portfolio_goal_notification_state s ON s.portfolio_id=g.portfolio_id AND s.user_id=g.user_id WHERE g.portfolio_id=? AND g.user_id=?"
      ).bind(portfolioId,user.id).first();
      return json({goal:goal||null});
    }
    const rows=await env.DB.prepare(
      "SELECT g.portfolio_id,g.user_id,g.target_value_eur,g.target_date,g.monthly_contribution_eur,g.risk_profile,g.created_at,g.updated_at,s.review_day,s.candidates AS review_candidates FROM portfolio_goals g LEFT JOIN portfolio_goal_notification_state s ON s.portfolio_id=g.portfolio_id AND s.user_id=g.user_id WHERE g.user_id=? ORDER BY g.updated_at DESC"
    ).bind(user.id).all();
    return json({goals:rows.results||[]});
  }
  if(request.method==="PUT"||request.method==="PATCH"||request.method==="POST"){
    const body=await readJson(request),portfolioId=trimText(body.portfolioId,80);
    if(!portfolioId||!(await onePortfolio(env,user.id,portfolioId)))return json({error:"Portfolio not found"},404);
    const raw=finiteNumber(body.targetValueEur!==undefined?body.targetValueEur:body.targetProfitEur);
    if(raw===null||raw<=0)return json({error:"targetValueEur must be greater than zero"},400);
    const target=Math.max(1,Math.min(100000000,Math.round(raw*100)/100)),now=nowIso();
    const existing=await env.DB.prepare(
      "SELECT portfolio_id,target_date,monthly_contribution_eur,risk_profile FROM portfolio_goals WHERE portfolio_id=? AND user_id=?"
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
    await env.DB.prepare(
      "INSERT INTO portfolio_goals (portfolio_id,user_id,target_value_eur,target_date,monthly_contribution_eur,risk_profile,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) "+
      "ON CONFLICT(portfolio_id) DO UPDATE SET target_value_eur=excluded.target_value_eur,target_date=excluded.target_date,monthly_contribution_eur=excluded.monthly_contribution_eur,risk_profile=excluded.risk_profile,updated_at=excluded.updated_at"
    ).bind(portfolioId,user.id,target,targetDate,monthlyContribution,riskProfile,now,now).run();
    const goal=await env.DB.prepare(
      "SELECT g.portfolio_id,g.user_id,g.target_value_eur,g.target_date,g.monthly_contribution_eur,g.risk_profile,g.created_at,g.updated_at,s.review_day,s.candidates AS review_candidates FROM portfolio_goals g LEFT JOIN portfolio_goal_notification_state s ON s.portfolio_id=g.portfolio_id AND s.user_id=g.user_id WHERE g.portfolio_id=? AND g.user_id=?"
    ).bind(portfolioId,user.id).first();
    return json({goal},existing?200:201);
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

async function scanNotificationPreferences(env,services){
  await ensureNotificationPreferenceSchema(env);
  await ensureGlobalNotificationSettingsSchema(env);
  const rows=await env.DB.prepare(
    "SELECT p.* FROM notification_preferences p LEFT JOIN user_notification_settings g ON g.user_id=p.user_id "+
    "WHERE COALESCE(g.opted_in_explicitly,0)=1 AND COALESCE(g.notifications_enabled,0)<>0 ORDER BY p.updated_at ASC LIMIT 24"
  ).all();
  if(!(rows.results||[]).length)return{processed:0};
  const snapshot=await services.loadMarketSnapshot(env),results=[],globalByUser=new Map();
  for(const pref of rows.results||[]){
    try{
      let global=globalByUser.get(pref.user_id);
      if(!global){global=await globalNotificationSettingsForUser(env,pref.user_id);globalByUser.set(pref.user_id,global)}
      if(!global.enabled)continue;
      const stock=findStock(snapshot,pref);
      if(!stock){
        await env.DB.prepare("UPDATE notification_preferences SET updated_at=? WHERE id=?").bind(nowIso(),pref.id).run();
        continue;
      }
      const pulseConfigured=global.pulseAi&&Number(pref.pulse_enabled)===1;
      const radarConfigured=global.radar&&(Number(pref.radar_enabled)===1||Number(pref.pulse_enabled)===1);
      const signalConfigured=pulseConfigured||radarConfigured;
      const lastAiScan=new Date(pref.last_ai_scan_at||0).getTime();
      const aiDue=signalConfigured&&(!Number.isFinite(lastAiScan)||Date.now()-lastAiScan>=5*60000);
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
        await env.DB.prepare("UPDATE notification_preferences SET anchor_price=?,updated_at=? WHERE id=?").bind(anchorPrice,nowIso(),pref.id).run();
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
          await env.DB.prepare("UPDATE notification_preferences SET price_above=NULL WHERE id=?").bind(pref.id).run();
        }
        if(below!==null&&price<=below){
          await sendPreferenceAlert(env,pref,"price-level-down","warning","Nivel alcanzado · "+pref.ticker,"Cotiza a "+fmt(price)+": ha caído por debajo de tu nivel de "+fmt(below)+".");
          await env.DB.prepare("UPDATE notification_preferences SET price_below=NULL WHERE id=?").bind(pref.id).run();
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
        if(fallback.score>=50)current=await aiAssessment(env,target,stock,chart,events,fallback);
        // Match the Radar AI screen: high conviction needs score>=68, data quality>=65, a chart and
        // an AI buy with confidence>=70; opportunities need score>=60 and quality>=48.
        // Opportunity uses the deterministic score like the screen; high conviction also needs a real
        // model answer (aiValidated), never the deterministic fallback.
        const radarQuality=finiteNumber(fallback.quality)??0,radarScore=finiteNumber(fallback.score)??0;
        // «En vigilancia» is the screen's third tier: a candidate worth following (score>=50,
        // quality>=40) that does not yet reach the opportunity threshold.
        const nextRadar=current.aiValidated===true&&current.signal==="BUY"&&current.confidence>=70&&current.score>=68&&radarQuality>=65&&chart&&chart.available
          ?"HIGH"
          :(radarScore>=60&&radarQuality>=48?"OPPORTUNITY":(radarScore>=50&&radarQuality>=40?"WATCH":""));
        const nextPulse=String(current.signal||"WAIT").toUpperCase();
        const previousRadar=radarState;
        const previousPulse=pulseState;
        if(radarConfigured){
          const tierOn={HIGH:global.radarHigh,OPPORTUNITY:global.radarOpportunity,WATCH:global.radarWatch};
          const tierLabel={HIGH:"Alta convicción",OPPORTUNITY:"Oportunidad",WATCH:"En vigilancia"};
          if(nextRadar&&nextRadar!==previousRadar&&tierOn[nextRadar]){
            const engineSpec=globalThis.ViewInvAIScore&&typeof globalThis.ViewInvAIScore.speculative==="function"
              ?globalThis.ViewInvAIScore.speculative({price:finiteNumber(stock.price),marketCap:finiteNumber(stock.marketCap),avgVolume:finiteNumber(stock.avgVolume),events})
              :{speculative:false};
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
      const scanNow=nowIso();
      await env.DB.prepare("UPDATE notification_preferences SET last_up_bucket=?,last_down_bucket=?,last_pulse_state=?,last_radar_state=?,last_ai_scan_at=CASE WHEN ? THEN ? ELSE last_ai_scan_at END,updated_at=? WHERE id=?")
        .bind(upBucket,downBucket,pulseState,radarState,aiDue?1:0,scanNow,scanNow,pref.id).run();
      results.push(pref.id);
    }catch(error){
      console.warn("Notification preference scan failed",pref.id,String(error&&error.message||error));
      try{await env.DB.prepare("UPDATE notification_preferences SET updated_at=? WHERE id=?").bind(nowIso(),pref.id).run()}catch(_){}
    }
  }
  return{processed:results.length};
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
  const model = trimText(env.AI_MODEL || DEFAULT_AI_MODEL, 120) || DEFAULT_AI_MODEL;

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
    const result = await env.AI.run(model, { prompt, max_tokens: 900, temperature: 0.12 });
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
      model: String(env.AI_MODEL || DEFAULT_AI_MODEL),
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
    if (root === "portfolio-performance") return handlePortfolioPerformance(request, env, user, json, url, services);
    if (root === "fund-portfolios") return handleFundPortfolios(request, env, user, json, parts);
    if (root === "fund-positions") return handleFundPositions(request, env, user, json, parts, url);
    if (root === "fund-transactions") return handleFundTransactions(request, env, user, json, parts, url);
    if (root === "fund-plans") return handleFundPlans(request, env, user, json, parts, url);
    if (root === "watchlist") return handleWatchlist(request, env, user, json, parts);
    if (root === "analysis" && parts[1] === "run") return handleManualAnalysis(request, env, user, json, services);
    if (root === "analysis") return handleAnalysisList(request, env, user, json, url);
    if (root === "ai" && parts[1] === "chat") return handleAiChat(request, env, user, json, services);
    if (root === "alerts") return handleAlerts(request, env, user, json, parts);
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
  for(const column of ["review_day TEXT NOT NULL DEFAULT ''","candidates TEXT NOT NULL DEFAULT '[]'","risk_signature TEXT NOT NULL DEFAULT ''"]){
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
function goalServerRiskBand(riskProfile){
  // Mirror of portfolioGoalRiskBand in portfolio.js (Bajo / Moderado / Alto chosen by the user).
  const bands={
    conservative:{maxPosition:8,riskPerTradePct:.5,maxSpreadPct:2,maxRoundTripFeePct:.5,minCandidate:84,minQuality:75,minConfidence:80,minVelocity:80,minComposite:85,minTiming:78,minRR:2.2,maxExtensionPct:4,maxDayChangePct:6,maxWeekPerfPct:10,maxStopPct:5},
    balanced:{maxPosition:15,riskPerTradePct:1,maxSpreadPct:3,maxRoundTripFeePct:1,minCandidate:82,minQuality:70,minConfidence:78,minVelocity:78,minComposite:83,minTiming:72,minRR:2,maxExtensionPct:5.5,maxDayChangePct:8,maxWeekPerfPct:15,maxStopPct:6},
    aggressive:{maxPosition:25,riskPerTradePct:2,maxSpreadPct:5,maxRoundTripFeePct:1.5,minCandidate:80,minQuality:66,minConfidence:76,minVelocity:76,minComposite:82,minTiming:68,minRR:1.8,maxExtensionPct:7,maxDayChangePct:10,maxWeekPerfPct:20,maxStopPct:7}
  };
  return bands[String(riskProfile||"aggressive").toLowerCase()]||bands.aggressive;
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
function goalServerEntryTiming(snapshot,stock,scope,spread,band){
  const preferTr=scope==="tr",eurUsd=finiteNumber(snapshot&&snapshot.meta&&snapshot.meta.eurUsd);
  const trPrice=finiteNumber(stock&&stock.trLivePrice),usPrice=finiteNumber((stock&&stock.usLivePrice)??(stock&&stock.price));
  const technicalPrice=preferTr?(trPrice!==null&&eurUsd!==null?trPrice*eurUsd:null):usPrice;
  const ema20=finiteNumber(stock&&stock.ema20),ema50=finiteNumber(stock&&stock.ema50);
  const dayHigh=finiteNumber((stock&&stock.usLiveDayHigh)??(stock&&stock.dayHigh)),dayLow=finiteNumber((stock&&stock.usLiveDayLow)??(stock&&stock.dayLow));
  const dayChange=finiteNumber(preferTr?(stock&&stock.trLiveChangePct):((stock&&stock.usLiveChangePct)??(stock&&stock.changePct)))??0;
  const weekPerf=finiteNumber(stock&&stock.perfWeek);
  const extensionPct=technicalPrice!==null&&ema20!==null&&ema20>0?(technicalPrice/ema20-1)*100:null;
  const nearHighPct=technicalPrice!==null&&dayHigh!==null&&dayHigh>0&&technicalPrice<=dayHigh?(dayHigh-technicalPrice)/dayHigh*100:null;
  const supportCandidates=[ema20,dayLow].filter(v=>v!==null&&technicalPrice!==null&&v>0&&v<technicalPrice);
  const support=supportCandidates.length?Math.max(...supportCandidates):null;
  let stopPct=support!==null&&technicalPrice>0?(technicalPrice-support)/technicalPrice*100+.7:4.5+Math.min(1.5,Math.abs(dayChange)*.1);
  stopPct=Math.max(3.5,Math.min(band.maxStopPct||7,stopPct));
  let takePct=12;
  if(extensionPct!==null)takePct-=Math.max(0,extensionPct)*.45;
  takePct-=Math.max(0,dayChange-3)*.22;
  if(weekPerf!==null)takePct-=Math.max(0,weekPerf-8)*.08;
  takePct=Math.max(5.5,Math.min(16,takePct));
  const rr=stopPct>0?takePct/stopPct:null;
  let timing=100;
  if(extensionPct!==null&&extensionPct>0)timing-=Math.min(34,extensionPct*3.1);
  if(dayChange>3)timing-=Math.min(24,(dayChange-3)*2);
  if(weekPerf!==null&&weekPerf>8)timing-=Math.min(18,(weekPerf-8)*.8);
  if(nearHighPct!==null&&nearHighPct<.8&&dayChange>4)timing-=10;
  if(spread!==null)timing-=Math.min(14,spread*1.8);
  if(ema20!==null&&ema50!==null&&ema20<ema50)timing-=14;
  if(dayChange<-.75)timing-=Math.min(18,Math.abs(dayChange+.75)*3);
  timing=Math.max(0,Math.min(100,timing));
  const eligible=
    !(extensionPct!==null&&extensionPct>band.maxExtensionPct)&&
    !(dayChange>band.maxDayChangePct)&&
    !(weekPerf!==null&&weekPerf>band.maxWeekPerfPct)&&
    dayChange>=-.75&&rr!==null&&rr>=band.minRR&&timing>=band.minTiming&&
    !(nearHighPct!==null&&nearHighPct<.5&&dayChange>6);
  return{eligible,timing,rr,stopPct,takePct,extensionPct,dayChange,weekPerf};
}
function goalServerCandidate(snapshot,stock,scope,band){
  const preferTr=scope==="tr",trPrice=preferTr?finiteNumber(stock.trLivePrice):null;
  const chart=preferTr&&trPrice!==null?{available:true,last:trPrice,return20:finiteNumber(stock.trLiveChangePct)}:{available:false};
  const target={subject_type:"watchlist",subject_id:"goal-scan",user_id:"",stock_key:goalServerKey(stock),ticker:stock.ticker||stock.trTicker||"",prefer_tr:preferTr?1:0};
  const events=recentEvents(snapshot,stock,12),a=deterministicAssessment(target,stock,chart,events);
  const catalyst=events.filter(event=>{
    const when=new Date(event&&event.date||0).getTime();
    return Number.isFinite(when)&&when>=Date.now()-3600000&&when<=Date.now()+14*86400000;
  }).sort((x,y)=>(finiteNumber(y&&y.impactScore)??0)-(finiteNumber(x&&x.impactScore)??0))[0]||null;
  const impact=finiteNumber(catalyst&&catalyst.impactScore)??0,rel=finiteNumber(stock.relVolume)??1;
  const signedChange=finiteNumber(preferTr?stock.trLiveChangePct:(stock.usLiveChangePct??stock.changePct))??0;
  const bid=preferTr?finiteNumber(stock.trLiveBid):finiteNumber(stock.usLiveBid??stock.usBid);
  const ask=preferTr?finiteNumber(stock.trLiveAsk):finiteNumber(stock.usLiveAsk??stock.usAsk);
  const mid=bid!==null&&ask!==null&&ask>=bid?(bid+ask)/2:null,spread=mid&&mid>0?(ask-bid)/mid*100:null;
  const spreadPenalty=spread===null?5:Math.min(16,spread*2);
  const adx=finiteNumber(stock.adx),ema20=finiteNumber(stock.ema20),ema50=finiteNumber(stock.ema50);
  const momentum=Math.max(0,Math.min(34,(signedChange+1.5)*3.2));
  const volume=Math.max(0,Math.min(22,rel*8));
  const trendStrength=adx===null?6:Math.max(0,Math.min(16,(adx-10)*.8));
  const trend=ema20!==null&&ema50!==null&&ema20>=ema50?12:ema20!==null&&ema50!==null?-4:0;
  const velocity=Math.max(0,Math.min(100,momentum+volume+trendStrength+trend+Math.min(12,impact*.12)+Math.min(6,a.quality*.06)+Math.min(6,a.score*.06)));
  const entry=goalServerEntryTiming(snapshot,stock,scope,spread,band);
  const composite=Math.max(0,Math.min(100,a.score*.34+a.quality*.20+velocity*.16+entry.timing*.22+Math.min(2,impact*.02)-spreadPenalty));
  return{stock,score:a.score,quality:a.quality,confidence:a.confidence,velocity,composite,catalyst,preferTr,spread,entry};
}
function goalServerFinalists(rows,band){
  if(!rows.length)return[];
  const out=[rows[0]];
  if(rows[1]&&rows[1].composite>=Math.max(band.minComposite,rows[0].composite-3))out.push(rows[1]);
  return out;
}
async function scanPortfolioGoalNotifications(env,services){
  if(!services.loadMarketSnapshot)return{processed:0,alerts:0};
  await ensurePortfolioGoalNotificationStateSchema(env);
  const goals=await env.DB.prepare(
    // Every goal gets its daily review (the screen shows which buys are confirmed);
    // notifications are only sent to users who opted in to goal alerts.
    "SELECT g.portfolio_id,g.user_id,g.target_value_eur,g.risk_profile,p.name,p.base_currency,COALESCE(m.market_scope,'auto') AS market_scope,COALESCE(m.cash_balance,0) AS cash_balance,"+
    "CASE WHEN n.opted_in_explicitly=1 AND n.notifications_enabled=1 AND n.portfolio_goal_enabled=1 THEN 1 ELSE 0 END AS notify "+
    "FROM portfolio_goals g JOIN portfolios p ON p.id=g.portfolio_id AND p.user_id=g.user_id "+
    "LEFT JOIN portfolio_market_settings m ON m.portfolio_id=g.portfolio_id AND m.user_id=g.user_id "+
    "LEFT JOIN user_notification_settings n ON n.user_id=g.user_id "+
    "ORDER BY g.updated_at DESC LIMIT 40"
  ).all();
  if(!(goals.results||[]).length)return{processed:0,alerts:0};
  const clock=goalServerReviewClock();
  // Outside the review window only notified users need the intraday stop check.
  const work=(goals.results||[]).filter(goal=>clock.inWindow||Number(goal.notify)===1);
  if(!work.length)return{processed:0,alerts:0};
  const snapshot=await services.loadMarketSnapshot(env),stocks=Array.isArray(snapshot&&snapshot.stocks)?snapshot.stocks:[],usdToEur=goalServerUsdToEur(snapshot);
  const quoteCache=new Map();
  const verifiedGoalPriceEur=async(stock,preferTr,side="LAST")=>{
    if(!stock||!services.loadQuote)return null;
    const key=(preferTr?"tr:":"us:")+goalServerKey(stock),cached=quoteCache.get(key);
    let quote=cached&&Date.now()-cached.at<15000?cached.quote:null;
    if(!quote){
      try{
        quote=await services.loadQuote(stock,{prefer_tr:preferTr?1:0,ticker:stock.ticker||stock.trTicker||"",isin:preferTr?(stock.trIsin||stock.isin||""):(stock.usIsin||stock.isin||"")});
        quoteCache.set(key,{at:Date.now(),quote});
      }catch(error){
        console.warn("Portfolio goal verified quote unavailable",key,String(error&&error.message||error));
        return null;
      }
    }
    const direction=String(side||"LAST").toUpperCase();
    const native=direction==="BUY"?finiteNumber(quote&&quote.ask):direction==="SELL"?finiteNumber(quote&&quote.bid):finiteNumber(quote&&quote.price);
    if(native===null)return null;
    return preferTr?native:(usdToEur!==null?native*usdToEur:null);
  };
  const saveState=(goal,fields)=>env.DB.prepare(
    "INSERT INTO portfolio_goal_notification_state (portfolio_id,user_id,signature,summary,review_day,candidates,risk_signature,updated_at) VALUES (?,?,?,?,?,?,?,?) "+
    "ON CONFLICT(portfolio_id) DO UPDATE SET signature=excluded.signature,summary=excluded.summary,review_day=excluded.review_day,candidates=excluded.candidates,risk_signature=excluded.risk_signature,updated_at=excluded.updated_at"
  ).bind(goal.portfolio_id,goal.user_id,fields.signature,fields.summary,fields.review_day,fields.candidates,fields.risk_signature,nowIso()).run();
  const pushGoal=async(goal,{title,message,severity,stockKey="",ticker="",preferTr=0})=>{
    if(Number(goal.notify)!==1)return false;
    const id=uid("al_"),now=nowIso();
    await env.DB.prepare("INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id,goal.user_id,stockKey,trimText(ticker,24),"","portfolio-goal",severity,title,message,now).run();
    await dispatchPushAlert(env,{id,alert_type:"portfolio-goal",severity,title,message},{user_id:goal.user_id,route:"portfolio-goal",portfolio_id:goal.portfolio_id,stock_key:stockKey,ticker,prefer_tr:preferTr});
    return true;
  };
  let processed=0,alerts=0;
  for(const goal of work){
    try{
      const positionsResult=await env.DB.prepare(
        "SELECT id,stock_key,ticker,prefer_tr,quantity,avg_price,currency,opened_at,broker,exchange,last_signal,last_score,last_confidence,"+
        "(SELECT MAX(t.executed_at) FROM transactions t WHERE t.position_id=positions.id AND t.user_id=positions.user_id AND t.side='BUY') AS last_buy_at "+
        "FROM positions WHERE user_id=? AND portfolio_id=? AND active=1 ORDER BY created_at ASC"
      ).bind(goal.user_id,goal.portfolio_id).all();
      const positions=positionsResult.results||[];
      let scope=String(goal.market_scope||"auto").toLowerCase();
      if(scope==="auto"&&positions.length){
        const markets=new Set(positions.map(p=>Number(p.prefer_tr)===1?"tr":"us"));
        if(markets.size===1)scope=[...markets][0];
      }
      if(!["tr","us"].includes(scope))continue;
      const prev=await env.DB.prepare("SELECT signature,summary,review_day,candidates,risk_signature FROM portfolio_goal_notification_state WHERE portfolio_id=? AND user_id=?").bind(goal.portfolio_id,goal.user_id).first();
      const state={signature:prev?String(prev.signature||""):"",review_day:prev?String(prev.review_day||""):"",candidates:prev?String(prev.candidates||"[]"):"[]",risk_signature:prev?String(prev.risk_signature||""):"",summary:""};
      const goalBand=goalServerRiskBand(goal.risk_profile);
      const sellKeys=new Set(),sells=[],stops=[];let released=0,capital=0,quotesIncomplete=false;
      for(const p of positions){
        const stock=findStock(snapshot,p),qty=Math.max(0,finiteNumber(p.quantity)??0),preferTr=Number(p.prefer_tr)===1;
        const markPrice=await verifiedGoalPriceEur(stock,preferTr,"LAST"),sellPrice=await verifiedGoalPriceEur(stock,preferTr,"SELL");
        if(qty>0&&markPrice===null){quotesIncomplete=true;break}
        if(markPrice!==null)capital+=qty*markPrice;
        const score=finiteNumber(p.last_score)??50,signal=String(p.last_signal||"").toUpperCase();
        // Holding time counts from the latest buy (a repurchase restarts it); unknown dates do not block exits.
        const heldSince=new Date(p.last_buy_at||p.opened_at||"").getTime();
        const heldDays=Number.isFinite(heldSince)&&heldSince>0?Math.max(0,(Date.now()-heldSince)/86400000):null;
        const monthMove=Math.abs(finiteNumber(stock&&stock.perfMonth)??finiteNumber(stock&&stock.perfWeek)??99);
        const stagnant=heldDays!==null&&heldDays>=21&&monthMove<2&&score<60;
        const avg=finiteNumber(p.avg_price),entryCurrency=String(p.currency||(preferTr?"EUR":"USD")).toUpperCase();
        const avgEur=avg===null?null:entryCurrency==="EUR"?avg:entryCurrency==="USD"&&usdToEur!==null?avg*usdToEur:null;
        const positionReturnPct=avgEur!==null&&avgEur>0&&markPrice!==null?(markPrice/avgEur-1)*100:null;
        const stopHit=positionReturnPct!==null&&positionReturnPct<=-goalBand.maxStopPct;
        const takeHit=positionReturnPct!==null&&positionReturnPct>=goalBand.maxStopPct*goalBand.minRR;
        // Exits: the stop always applies; anything else waits a 3-day minimum hold.
        const pct=stopHit?100:heldDays!==null&&heldDays<3?0:signal==="SELL"||score<=35||stagnant?100:takeHit?50:score<40?50:0;
        if(pct<=0||qty<1)continue;
        // Only a planned sale needs the bid; without it this minute the plan is unknown, not changed.
        if(sellPrice===null){quotesIncomplete=true;break}
        const units=Math.max(1,Math.min(Math.floor(qty),Math.round(qty*pct/100)));
        const fee=preferTr?1:0;
        released+=Math.max(0,units*sellPrice-fee);
        sellKeys.add(String(p.stock_key||"").toUpperCase());
        sells.push({ticker:p.ticker||stock&&stock.ticker||"",units,fee});
        if(stopHit)stops.push({ticker:p.ticker||stock&&stock.ticker||"",units,stockKey:String(p.stock_key||""),preferTr});
      }
      if(quotesIncomplete){processed++;continue}

      // Risk events are the only intraday notifications: a newly hit stop is sent at once.
      // Stop alerts are latched per position and New York day ("day|T1,T2"), so a price that
      // oscillates around the stop produces one alert, not one per crossing.
      const [riskDay,riskList]=state.risk_signature.includes("|")?state.risk_signature.split("|"):["",""];
      const known=new Set(riskDay===clock.day&&riskList?riskList.split(","):[]);
      const fresh=stops.filter(x=>!known.has(x.ticker));
      let riskSignature=state.risk_signature;
      if(fresh.length){
        if(prev&&await pushGoal(goal,{title:"Riesgo · "+goal.name,severity:"high",stockKey:fresh[0].stockKey,ticker:fresh[0].ticker,preferTr:fresh[0].preferTr?1:0,
          message:trimText("Stop alcanzado: vender "+fresh.map(x=>x.units+" "+x.ticker).join(", ")+" para limitar la pérdida.",500)}))alerts++;
        for(const x of fresh)known.add(x.ticker);
        riskSignature=clock.day+"|"+[...known].sort().join(",");
      }
      state.risk_signature=riskSignature;
      if(!clock.inWindow||state.review_day===clock.day){
        if(prev&&riskSignature!==String(prev.risk_signature||""))await saveState(goal,{...state,summary:String(prev.summary||"")});
        else if(!prev)await saveState(goal,state);
        processed++;continue;
      }

      let cashEur=Math.max(0,finiteNumber(goal.cash_balance)??0);
      if(String(goal.base_currency||"EUR").toUpperCase()==="USD")cashEur=usdToEur===null?0:cashEur*usdToEur;
      capital+=cashEur;
      const target=finiteNumber(goal.target_value_eur);
      if(target!==null&&capital>=target){
        const signature="GOAL_REACHED",summary="Objetivo alcanzado · no se fuerza una nueva operación.";
        await saveState(goal,{...state,signature,summary,review_day:clock.day,candidates:"[]"});
        if(state.review_day&&state.signature&&state.signature!==signature&&await pushGoal(goal,{title:"Objetivo IA · "+goal.name,message:summary,severity:"info"}))alerts++;
        processed++;continue;
      }
      const pool=cashEur+released;
      let candidates=[];
      if(pool>0){
        candidates=stocks.filter(stock=>goalServerAllowed(stock,scope)&&!sellKeys.has(goalServerKey(stock)))
          .map(stock=>goalServerCandidate(snapshot,stock,scope,goalBand))
          .filter(row=>row&&row.entry&&row.entry.eligible&&
            row.score>=goalBand.minCandidate&&row.quality>=goalBand.minQuality&&row.confidence>=goalBand.minConfidence&&
            row.velocity>=goalBand.minVelocity&&row.composite>=goalBand.minComposite&&(row.spread===null||row.spread<=goalBand.maxSpreadPct))
          .sort((x,y)=>y.composite-x.composite||y.entry.timing-x.entry.timing||y.velocity-x.velocity||y.score-x.score)
          .slice(0,12);
      }
      // Hysteresis: a buy must have qualified in the previous daily review too.
      let previousCandidates=[];
      try{previousCandidates=JSON.parse(state.candidates||"[]")}catch(_){previousCandidates=[]}
      const confirmedSet=new Set(Array.isArray(previousCandidates)?previousCandidates:[]);
      const confirmed=candidates.filter(row=>confirmedSet.has(goalServerKey(row.stock)));
      const finalistRows=goalServerFinalists(confirmed,goalBand);
      // Buy fees come from the broker this portfolio already uses for that market (TR / IBKR built-ins).
      const brokerFor=preferTr=>{
        const counts=new Map();
        for(const p of positions)if((Number(p.prefer_tr)===1)===preferTr&&p.broker)counts.set(p.broker,(counts.get(p.broker)||0)+1);
        return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||(preferTr?"Trade Republic":"IBKR");
      };
      const feeEurFor=async(row,units,unitEur)=>{
        const currency=row.preferTr?"EUR":"USD",nativePrice=row.preferTr?unitEur:(usdToEur?unitEur/usdToEur:null);
        if(nativePrice===null)return null;
        const info=await brokerFeeForTrade(env,goal.user_id,brokerFor(row.preferTr),units,nativePrice,currency,"BUY",row.preferTr?"LSX":String(row.stock.exchange||"NASDAQ"));
        if(info.fee===null)return null;
        return row.preferTr?info.fee:(usdToEur?info.fee*usdToEur:null);
      };
      const pricedFinalists=await Promise.all(finalistRows.map(async row=>{
        const unitEur=await verifiedGoalPriceEur(row.stock,row.preferTr,"BUY");
        return{...row,unitEur,fee:unitEur===null?null:await feeEurFor(row,1,unitEur)};
      }));
      // A finalist without a quote this minute is unknown, not rejected: retry within the window.
      if(pricedFinalists.some(row=>row.unitEur===null)){processed++;continue}
      // Without a known fee the ticket cannot be checked against the fee limit, so it is not proposed.
      const finalists=pricedFinalists.filter(row=>row.fee!==null&&row.unitEur>0&&row.unitEur+row.fee<=pool);
      const weights=finalists.length===1?[1]:[.65,.35],buys=[];
      for(const [index,row] of finalists.slice(0,2).entries()){
        const maxPositionEur=Math.max(0,capital*goalBand.maxPosition/100);
        const riskBudgetEur=Math.max(0,capital*goalBand.riskPerTradePct/100);
        const riskAllocationCap=row.entry&&row.entry.stopPct>0?riskBudgetEur/(row.entry.stopPct/100):0;
        const allocationCap=Math.max(0,Math.min(maxPositionEur,riskAllocationCap));
        const budget=Math.min(pool*weights[index],allocationCap);
        const units=Math.floor(Math.max(0,budget-row.fee)/row.unitEur);
        if(units<1)continue;
        const allocation=units*row.unitEur,fee=await feeEurFor(row,units,row.unitEur);
        // Skip tickets where buying and later selling would cost too much relative to the position.
        if(fee===null||fee*2/allocation*100>goalBand.maxRoundTripFeePct)continue;
        buys.push({
          ticker:row.stock.trTicker||row.stock.ticker||"",stockKey:goalServerKey(row.stock),units,
          score:Math.round(row.composite),timing:Math.round(row.entry.timing),rr:Math.round(row.entry.rr*100)/100,fee
        });
      }
      const signature=JSON.stringify({sells:sells.map(x=>[x.ticker,x.units]),buys:buys.map(x=>[x.ticker,x.units])});
      const pieces=[];
      if(sells.length)pieces.push("Vender "+sells.map(x=>x.units+" "+x.ticker).join(", "));
      if(buys.length)pieces.push("Comprar "+buys.map((x,i)=>"#"+(i+1)+" "+x.units+" "+x.ticker).join(", "));
      if(!pieces.length)pieces.push("Sin cambios: ningún candidato supera dos revisiones seguidas con el filtro estricto.");
      const summary=trimText(pieces.join(" · "),500);
      await saveState(goal,{...state,signature,summary,review_day:clock.day,candidates:JSON.stringify(candidates.map(row=>goalServerKey(row.stock)))});
      // The first daily review (including rows migrated from the old per-minute state) only records the plan.
      if(state.review_day&&state.signature&&state.signature!==signature){
        if(await pushGoal(goal,{title:"Revisión diaria · "+goal.name,message:summary,severity:"high",stockKey:buys[0]&&buys[0].stockKey||"",ticker:buys[0]&&buys[0].ticker||"",preferTr:scope==="tr"?1:0}))alerts++;
      }
      processed++;
    }catch(error){
      console.warn("Portfolio goal notification scan failed",goal.portfolio_id,String(error&&error.message||error));
    }
  }
  return{processed,alerts};
}

export async function runScheduledPortfolioAnalysis(env, services = {}) {
  if (!env.DB || !services.loadMarketSnapshot || !services.loadChart) {
    return { skipped: true, reason: "backend-not-configured" };
  }
  await ensurePortfolioGoalSchema(env);

  const nowDate = new Date();
  if (nowDate.getUTCHours() === 3 && nowDate.getUTCMinutes() < 5) {
    try { await cleanupOldBackendData(env); }
    catch (error) { console.warn("Backend retention cleanup failed", String(error && error.message || error)); }
  }

  const [positionRows, watchRows] = await Promise.all([
    env.DB.prepare(
      "SELECT 'position' AS subject_type,p.id AS subject_id,p.user_id,p.stock_key,p.ticker,p.name,p.exchange,p.isin,p.prefer_tr,p.quantity,p.avg_price,p.currency,p.last_analysis_at," +
      "CASE WHEN g.portfolio_id IS NOT NULL THEN 5 ELSE COALESCE(s.analysis_positions_minutes,10) END AS analysis_interval_minutes " +
      "FROM positions p LEFT JOIN user_settings s ON s.user_id=p.user_id LEFT JOIN portfolio_goals g ON g.portfolio_id=p.portfolio_id AND g.user_id=p.user_id WHERE p.active=1 " +
      "ORDER BY COALESCE(p.last_analysis_at,'') ASC LIMIT 40"
    ).all(),
    env.DB.prepare(
      "SELECT 'watchlist' AS subject_type,w.id AS subject_id,w.user_id,w.stock_key,w.ticker,w.name,w.exchange,w.isin,w.prefer_tr,NULL AS quantity,NULL AS avg_price,'EUR' AS currency,w.last_analysis_at," +
      "COALESCE(s.analysis_watchlist_minutes,30) AS analysis_interval_minutes " +
      "FROM watchlist w LEFT JOIN user_settings s ON s.user_id=w.user_id " +
      "ORDER BY COALESCE(w.last_analysis_at,'') ASC LIMIT 40"
    ).all()
  ]);

  const nowMs = Date.now();
  const due = row => {
    if (!row.last_analysis_at) return true;
    const last = new Date(row.last_analysis_at).getTime();
    const minutes = Math.max(row.subject_type === "position" ? 5 : 10, finiteNumber(row.analysis_interval_minutes) ?? (row.subject_type === "position" ? 10 : 30));
    return !Number.isFinite(last) || nowMs - last >= minutes * 60000;
  };
  const positions = (positionRows.results || []).filter(due);
  const watchlist = (watchRows.results || []).filter(due);
  const queue = [...positions, ...watchlist]
    .sort((a,b) => String(a.last_analysis_at || "").localeCompare(String(b.last_analysis_at || "")))
    .slice(0, 8);
  const results = [];

  for (const target of queue) {
    try {
      const analysis = await analyzeTarget(env, target, services);
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
  try{preferences=await scanNotificationPreferences(env,services)}catch(error){console.warn("Notification preference sweep failed",String(error&&error.message||error))}
  try{portfolioGoals=await scanPortfolioGoalNotifications(env,services)}catch(error){console.warn("Portfolio goal notification sweep failed",String(error&&error.message||error))}
  return { processed: results.length, results, trackedNews, catalystEve, preferences, portfolioGoals };
}
