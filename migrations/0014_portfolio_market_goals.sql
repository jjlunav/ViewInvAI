PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portfolio_market_settings (
  portfolio_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  market_scope TEXT NOT NULL DEFAULT 'auto',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolio_market_settings_user
  ON portfolio_market_settings(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_goals (
  portfolio_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_value_eur REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolio_goals_user
  ON portfolio_goals(user_id, updated_at DESC);

INSERT OR IGNORE INTO portfolio_goals (
  portfolio_id,user_id,target_value_eur,created_at,updated_at
)
SELECT
  p.id,p.user_id,g.target_profit_eur,g.created_at,g.updated_at
FROM portfolios p
JOIN stock_portfolio_goals g
  ON g.user_id=p.user_id;
