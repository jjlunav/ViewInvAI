PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stock_portfolio_goals (
  user_id TEXT PRIMARY KEY,
  target_profit_eur REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
