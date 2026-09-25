PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  exchange TEXT NOT NULL DEFAULT '',
  isin TEXT NOT NULL DEFAULT '',
  prefer_tr INTEGER NOT NULL DEFAULT 0,
  side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
  quantity REAL NOT NULL CHECK(quantity > 0),
  price REAL NOT NULL CHECK(price >= 0),
  fees REAL NOT NULL DEFAULT 0 CHECK(fees >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  executed_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date
  ON transactions(user_id, executed_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_date
  ON transactions(portfolio_id, executed_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_stock
  ON transactions(user_id, portfolio_id, stock_key, executed_at, created_at);

CREATE INDEX IF NOT EXISTS idx_analysis_cleanup
  ON analysis_snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_cleanup
  ON alert_events(created_at);
