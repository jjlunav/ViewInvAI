PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  prefer_tr INTEGER NOT NULL DEFAULT 0,
  news_enabled INTEGER NOT NULL DEFAULT 1,
  pulse_enabled INTEGER NOT NULL DEFAULT 1,
  radar_enabled INTEGER NOT NULL DEFAULT 0,
  price_up_enabled INTEGER NOT NULL DEFAULT 0,
  price_down_enabled INTEGER NOT NULL DEFAULT 0,
  price_up_step REAL NOT NULL DEFAULT 3,
  price_down_step REAL NOT NULL DEFAULT 3,
  anchor_price REAL,
  last_up_bucket INTEGER NOT NULL DEFAULT 0,
  last_down_bucket INTEGER NOT NULL DEFAULT 0,
  last_pulse_state TEXT NOT NULL DEFAULT '',
  last_radar_state TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_pref_user_stock
  ON notification_preferences(user_id,stock_key,prefer_tr);
