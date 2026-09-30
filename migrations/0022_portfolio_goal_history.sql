PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portfolio_goal_recommendation_history (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  plan_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolio_goal_history_lookup
  ON portfolio_goal_recommendation_history(user_id, portfolio_id, created_at DESC);
