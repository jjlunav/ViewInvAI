PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id TEXT PRIMARY KEY,
  news_events_enabled INTEGER NOT NULL DEFAULT 1 CHECK(news_events_enabled IN (0,1)),
  pulse_ai_enabled INTEGER NOT NULL DEFAULT 1 CHECK(pulse_ai_enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_notification_settings_updated
  ON user_notification_settings(updated_at DESC);
