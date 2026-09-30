PRAGMA foreign_keys = ON;

ALTER TABLE positions ADD COLUMN broker TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN broker TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS user_brokers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  fee_mode TEXT NOT NULL DEFAULT 'manual',
  fee_value REAL NOT NULL DEFAULT 0,
  fee_min REAL NOT NULL DEFAULT 0,
  fee_max_pct REAL,
  fee_currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_brokers_user_name
  ON user_brokers(user_id, name);
CREATE INDEX IF NOT EXISTS idx_user_brokers_user
  ON user_brokers(user_id, updated_at DESC);
