PRAGMA foreign_keys = ON;

ALTER TABLE user_notification_settings
  ADD COLUMN portfolio_goal_enabled INTEGER NOT NULL DEFAULT 0 CHECK(portfolio_goal_enabled IN (0,1));

CREATE TABLE IF NOT EXISTS portfolio_goal_notification_state (
  portfolio_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolio_goal_notification_state_user
  ON portfolio_goal_notification_state(user_id, updated_at DESC);
