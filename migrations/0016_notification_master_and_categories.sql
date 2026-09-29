PRAGMA foreign_keys = OFF;

ALTER TABLE user_notification_settings RENAME TO user_notification_settings_legacy;

CREATE TABLE user_notification_settings (
  user_id TEXT PRIMARY KEY,
  notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK(notifications_enabled IN (0,1)),
  news_events_enabled INTEGER NOT NULL DEFAULT 1 CHECK(news_events_enabled IN (0,1)),
  pulse_ai_enabled INTEGER NOT NULL DEFAULT 1 CHECK(pulse_ai_enabled IN (0,1)),
  radar_enabled INTEGER NOT NULL DEFAULT 1 CHECK(radar_enabled IN (0,1)),
  price_enabled INTEGER NOT NULL DEFAULT 1 CHECK(price_enabled IN (0,1)),
  portfolio_enabled INTEGER NOT NULL DEFAULT 1 CHECK(portfolio_enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO user_notification_settings (
  user_id,news_events_enabled,pulse_ai_enabled,created_at,updated_at
)
SELECT
  user_id,news_events_enabled,pulse_ai_enabled,created_at,updated_at
FROM user_notification_settings_legacy;

DROP TABLE user_notification_settings_legacy;

CREATE INDEX IF NOT EXISTS idx_user_notification_settings_updated
  ON user_notification_settings(updated_at DESC);

PRAGMA foreign_keys = ON;
