PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fund_contribution_plans (
  id TEXT PRIMARY KEY,
  fund_portfolio_id TEXT NOT NULL,
  fund_position_id TEXT,
  user_id TEXT NOT NULL,
  isin TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'monthly',
  amount REAL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  day_of_month INTEGER,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  enabled INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(fund_position_id) REFERENCES fund_positions(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fund_plans_user
  ON fund_contribution_plans(user_id, fund_portfolio_id, enabled);
