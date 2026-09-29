PRAGMA foreign_keys = ON;

ALTER TABLE notification_preferences ADD COLUMN last_ai_scan_at TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_pref_scan
  ON notification_preferences(updated_at,last_ai_scan_at);
