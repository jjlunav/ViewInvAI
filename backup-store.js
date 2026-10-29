import { financialRevision, financialBatch } from './financial-store.js';

// Explicit allowlist: credentials, AI keys, push tokens and admin configuration
// are never exported or accepted from a backup.
const TABLES = {
  portfolios:'portfolios', portfolioMarketSettings:'portfolio_market_settings',
  positions:'positions', transactions:'transactions', dividends:'dividends',
  watchlist:'watchlist', notificationPreferences:'notification_preferences',
  uiPreferenceRows:'user_ui_preferences', cryptoPositions:'crypto_positions',
  fundPortfolios:'fund_portfolios', fundPositions:'fund_positions',
  fundTransactions:'fund_transactions', fundPlans:'fund_contribution_plans',
  portfolioGoals:'portfolio_goals', positionDecisions:'position_decisions',
  userBrokers:'user_brokers', userSettings:'user_settings',
  notificationSettings:'user_notification_settings',
  goalSleeves:'goal_sleeves', goalSleeveMoves:'goal_sleeve_moves'
};
const REFS = {portfolio_id:'portfolios',position_id:'positions',fund_portfolio_id:'fundPortfolios',fund_position_id:'fundPositions'};

export async function exportBackup(db,userId){
  const results=await db.batch(Object.values(TABLES).map(table=>db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).bind(userId)));
  const out={app:'ViewInvAI',kind:'backup',version:2,sourceUserId:userId,exportedAt:new Date().toISOString()};
  Object.keys(TABLES).forEach((key,i)=>{out[key]=results[i].results.map(({user_id,...row})=>row)});
  out.portfolios=out.portfolios.map(p=>({...p,cash_balance:out.portfolioMarketSettings.find(s=>s.portfolio_id===p.id)?.cash_balance||0}));
  out.uiPreferences=Object.fromEntries(out.uiPreferenceRows.map(r=>[r.scope,JSON.parse(r.preferences_json)]));
  return out;
}

export async function restoreBackup(db,userId,backup){
  if(backup?.app!=='ViewInvAI'||backup.kind!=='backup'||backup.version!==2)throw Object.assign(new Error('Esta copia necesita el restaurador compatible con su versión.'),{status:400});
  for(const key of Object.keys(TABLES))if(backup[key]!==undefined&&!Array.isArray(backup[key]))throw Object.assign(new Error('Sección de copia no válida: '+key),{status:400});
  const revision=await financialRevision(db,userId),maps={},statements=[];
  const idTables=Object.entries(TABLES).filter(([key])=>(backup[key]||[]).some(r=>r?.id));
  const own=new Set();
  if(idTables.length){
    const sql=idTables.map(([key,table])=>`SELECT '${key}' AS kind,id FROM ${table} WHERE user_id=? AND id IN (SELECT value FROM json_each(?))`).join(' UNION ALL ');
    const args=idTables.flatMap(([key])=>[userId,JSON.stringify(backup[key].map(r=>r.id).filter(Boolean))]);
    for(const row of (await db.prepare(sql).bind(...args).all()).results)own.add(row.kind+'|'+row.id);
  }
  for(const [key,table] of Object.entries(TABLES)){
    maps[key]=new Map();
    for(const row of backup[key]||[]){
      if(!row||typeof row!=='object'||Array.isArray(row))throw Object.assign(new Error('Registro de copia no válido.'),{status:400});
      if(row.id){
        const old=String(row.id);
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(userId+'|'+table+'|'+old));
        const id=own.has(key+'|'+old)?old:'restore_'+Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,40);
        maps[key].set(old,id);
      }
    }
  }
  const schemas=await db.batch(Object.values(TABLES).map(table=>db.prepare(`PRAGMA table_info(${table})`)));
  let schemaIndex=0,detachedHistory=0;
  for(const [key,table] of Object.entries(TABLES)){
    const cols=schemas[schemaIndex++].results.map(c=>c.name),groups=new Map();
    for(const raw of backup[key]||[]){
      const row={...raw,user_id:userId};
      if(row.id)row.id=maps[key].get(String(row.id));
      for(const [column,target] of Object.entries(REFS))if(row[column]){
        const id=maps[target].get(String(row[column]));
        if(!id&&((key==='dividends'&&column==='portfolio_id')||(key==='positionDecisions'&&column==='position_id'))){row[column]='';detachedHistory++;continue}
        if(!id)throw Object.assign(new Error('Falta una relación en la copia: '+column),{status:400});
        row[column]=id;
      }
      const fields=cols.filter(c=>Object.hasOwn(row,c));
      const values=fields.map(c=>row[c]);
      if(values.some(v=>v!==null&&(!['string','number'].includes(typeof v)||(typeof v==='number'&&!Number.isFinite(v)))))throw Object.assign(new Error('Contenido de copia no válido.'),{status:400});
      // Existing records are preserved. Stable remapping makes a repeated restore
      // idempotent, including restoration into a different Firebase account.
      const signature=fields.join(',');
      if(!groups.has(signature))groups.set(signature,{fields,rows:[]});
      groups.get(signature).rows.push(Object.fromEntries(fields.map((c,i)=>[c,values[i]])));
    }
    for(const {fields,rows} of groups.values()){
      // JSON inserts keep a large history inside D1's query/parameter budget.
      for(let i=0;i<rows.length;i+=250)statements.push(db.prepare(`INSERT INTO ${table} (${fields.join(',')}) SELECT ${fields.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`).bind(JSON.stringify(rows.slice(i,i+250))));
    }
  }
  const results=await financialBatch(db,userId,revision,statements);
  const inserted=results.slice(1).reduce((n,r)=>n+Number(r.meta?.changes||0),0);
  const total=Object.keys(TABLES).reduce((n,k)=>n+(backup[k]||[]).length,0);
  return{restored:inserted,skipped:total-inserted,total,detachedHistory};
}
