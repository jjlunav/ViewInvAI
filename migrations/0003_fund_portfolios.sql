PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fund_portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  base_currency TEXT NOT NULL DEFAULT 'EUR',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fund_portfolios_user
  ON fund_portfolios(user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS fund_positions (
  id TEXT PRIMARY KEY,
  fund_portfolio_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  isin TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT 'fund' CHECK(product_type IN ('fund','etf')),
  provider TEXT NOT NULL DEFAULT '',
  index_name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  units REAL NOT NULL DEFAULT 0 CHECK(units >= 0),
  avg_price REAL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  opened_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_positions_portfolio_isin
  ON fund_positions(fund_portfolio_id, isin);
CREATE INDEX IF NOT EXISTS idx_fund_positions_user_active
  ON fund_positions(user_id, active);
CREATE INDEX IF NOT EXISTS idx_fund_positions_isin
  ON fund_positions(isin);

CREATE TABLE IF NOT EXISTS fund_transactions (
  id TEXT PRIMARY KEY,
  fund_portfolio_id TEXT NOT NULL,
  fund_position_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  isin TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
  units REAL NOT NULL CHECK(units > 0),
  price REAL NOT NULL CHECK(price >= 0),
  fees REAL NOT NULL DEFAULT 0 CHECK(fees >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  executed_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(fund_position_id) REFERENCES fund_positions(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fund_transactions_user_date
  ON fund_transactions(user_id, executed_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fund_transactions_position_date
  ON fund_transactions(fund_position_id, executed_at ASC, created_at ASC);
