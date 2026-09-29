PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_ui_preferences (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, scope),
  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_ui_preferences_user
  ON user_ui_preferences(user_id, updated_at DESC);
