// Prepare core account schema in a dedicated invocation, one bounded step at a
// time. Existing request-time upgrades remain available until readiness is proven.
const keys=new WeakMap(),memo=new WeakMap(),initialized=new WeakSet();
export const CORE_SCHEMA_CRON='* * * * 1-7';
async function schemaKey(steps){
 if(!keys.has(steps))keys.set(steps,crypto.subtle.digest('SHA-256',new TextEncoder().encode(steps.map(([name,fn,dependencies=''])=>name+':'+fn.toString()+':'+dependencies).join('\n'))).then(hash=>'core-v1-'+Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,24)));
 return keys.get(steps);
}
export async function coreSchemaStatus(db,steps){
 if(!db)return{configured:false,ready:false,completed:0,total:steps.length};
 const key=await schemaKey(steps);
 try{const row=await db.prepare('SELECT next_step,ready,updated_at FROM app_schema_state WHERE schema_key=?').bind(key).first();return{configured:true,ready:row?.ready===1,completed:Number(row?.next_step||0),total:steps.length,updatedAt:row?.updated_at||null}}
 catch(_){return{configured:true,ready:false,completed:0,total:steps.length}}
}
export async function coreSchemaReady(db,steps){
 if(!db)return false;
 const key=await schemaKey(steps),hit=memo.get(db);
 if(hit?.key===key&&(hit.ready||Date.now()-hit.at<30000))return hit.ready;
 const status=await coreSchemaStatus(db,steps);memo.set(db,{key,ready:status.ready,at:Date.now()});return status.ready;
}
export async function advanceCoreSchema(env,steps){
 const db=env.DB;if(!db)return coreSchemaStatus(db,steps);
 const key=await schemaKey(steps);
 const existing=await coreSchemaStatus(db,steps);if(existing.ready)return existing;
 if(!initialized.has(db)){
  await db.prepare('CREATE TABLE IF NOT EXISTS app_schema_state(schema_key TEXT PRIMARY KEY,next_step INTEGER NOT NULL DEFAULT 0,ready INTEGER NOT NULL DEFAULT 0,lease_token TEXT NOT NULL DEFAULT \'\',lease_until INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)').run();initialized.add(db);
 }
 await db.prepare('INSERT INTO app_schema_state(schema_key,updated_at) VALUES(?,?) ON CONFLICT(schema_key) DO NOTHING').bind(key,new Date().toISOString()).run();
 const status=await coreSchemaStatus(db,steps);if(status.ready)return status;
 const token=crypto.randomUUID(),now=Date.now();
 const lease=await db.prepare('UPDATE app_schema_state SET lease_token=?,lease_until=? WHERE schema_key=? AND ready=0 AND lease_until<=? AND next_step=?').bind(token,now+120000,key,now,status.completed).run();
 if(!Number(lease.meta?.changes))return status;
 try{
  await steps[status.completed][1](env);
  const next=status.completed+1,ready=next>=steps.length;
  await db.prepare('UPDATE app_schema_state SET next_step=?,ready=?,lease_token=\'\',lease_until=0,updated_at=? WHERE schema_key=? AND lease_token=?').bind(next,ready?1:0,new Date().toISOString(),key,token).run();
  memo.delete(db);return coreSchemaStatus(db,steps);
 }catch(error){
  await db.prepare('UPDATE app_schema_state SET lease_token=\'\',lease_until=0 WHERE schema_key=? AND lease_token=?').bind(key,token).run();
  console.warn('Core schema preparation deferred',steps[status.completed]?.[0],String(error?.message||error));
  return{...status,deferred:true};
 }
}
