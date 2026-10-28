// D1 batches are atomic. A revision checked in the same batch also protects
// the read/validate/write cycle against another request or an older client.
const TABLES = ['transactions', 'positions', 'portfolio_market_settings', 'portfolios', 'fund_transactions', 'fund_positions', 'fund_portfolios'];
const ready = new WeakMap();

export function financialSchema(tables = TABLES) {
  const sql = ["CREATE TABLE IF NOT EXISTS financial_revisions (user_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT financial_revision_conflict CHECK(revision>=0))"];
  for (const table of tables) for (const [event, row] of [['INSERT','NEW'], ['UPDATE','NEW'], ['DELETE','OLD']]) {
    const updateColumns=table==='positions'?'quantity,avg_price,cost_basis,fees_total,currency,broker,portfolio_id,stock_key,exchange,prefer_tr,active,frozen_qty,frozen_until':table==='fund_positions'?'units,avg_price,currency,fund_portfolio_id,isin,active':null;
    const operation=event==='UPDATE'&&updateColumns?'UPDATE OF '+updateColumns:event;
    sql.push(`CREATE TRIGGER IF NOT EXISTS financial_${table}_${event.toLowerCase()} AFTER ${operation} ON ${table} BEGIN INSERT INTO financial_revisions(user_id,revision) VALUES(${row}.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END`);
  }
  return sql;
}

export async function financialRevision(db, userId) {
  // Install only for tables that exist; a later call can add the fund triggers.
  const names=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all()).results.map(r=>r.name));
  const tables=TABLES.filter(t=>names.has(t));
  const installed = ready.get(db) || new Set();
  const missing = tables.filter(t => !installed.has(t)&&!names.has(`financial_${t}_insert`));
  if (!names.has("financial_revisions") || missing.length) {
    await db.batch(financialSchema(missing).map(sql => db.prepare(sql)));
    missing.forEach(t => installed.add(t));
    ready.set(db, installed);
  }
  const row = await db.prepare('SELECT revision FROM financial_revisions WHERE user_id=?').bind(userId).first();
  return Number(row?.revision || 0);
}

export async function financialBatch(db, userId, revision, statements) {
  try {
    return await db.batch([
      db.prepare('INSERT INTO financial_revisions(user_id,revision) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END').bind(userId, revision + 1, revision),
      ...statements
    ]);
  } catch (error) {
    if (/financial_revision_conflict/.test(String(error?.message || error))) {
      const conflict = new Error('La cartera ha cambiado durante la operación. Actualiza los datos y vuelve a intentarlo.');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}
