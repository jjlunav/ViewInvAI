PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'firebase',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  broker TEXT NOT NULL DEFAULT '',
  base_currency TEXT NOT NULL DEFAULT 'EUR',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  exchange TEXT NOT NULL DEFAULT '',
  isin TEXT NOT NULL DEFAULT '',
  prefer_tr INTEGER NOT NULL DEFAULT 0,
  quantity REAL,
  avg_price REAL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  opened_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  last_analysis_at TEXT,
  last_signal TEXT,
  last_confidence REAL,
  last_score REAL,
  last_snapshot_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_portfolio_stock ON positions(portfolio_id, stock_key);
CREATE INDEX IF NOT EXISTS idx_positions_user_active ON positions(user_id, active, last_analysis_at);
CREATE INDEX IF NOT EXISTS idx_positions_stock ON positions(stock_key);

CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  exchange TEXT NOT NULL DEFAULT '',
  isin TEXT NOT NULL DEFAULT '',
  prefer_tr INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  last_analysis_at TEXT,
  last_signal TEXT,
  last_confidence REAL,
  last_score REAL,
  last_snapshot_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_user_stock ON watchlist(user_id, stock_key);
CREATE INDEX IF NOT EXISTS idx_watchlist_due ON watchlist(user_id, last_analysis_at);

CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('position','watchlist')),
  subject_id TEXT NOT NULL,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  signal TEXT NOT NULL,
  confidence REAL NOT NULL,
  score REAL NOT NULL,
  previous_score REAL,
  horizon TEXT NOT NULL DEFAULT '1-2d',
  thesis TEXT NOT NULL DEFAULT '',
  risk_summary TEXT NOT NULL DEFAULT '',
  reasons_json TEXT NOT NULL DEFAULT '[]',
  catalysts_json TEXT NOT NULL DEFAULT '[]',
  technical_json TEXT NOT NULL DEFAULT '{}',
  market_json TEXT NOT NULL DEFAULT '{}',
  ai_model TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT '',
  data_timestamp TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_user_stock ON analysis_snapshots(user_id, stock_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_subject ON analysis_snapshots(subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  snapshot_id TEXT,
  read_at TEXT,
  pushed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_created ON alert_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_user_unread ON alert_events(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  push_token TEXT NOT NULL,
  app_version TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_push_token ON devices(push_token);
CREATE INDEX IF NOT EXISTS idx_devices_user_enabled ON devices(user_id, enabled);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  analysis_positions_minutes INTEGER NOT NULL DEFAULT 10,
  analysis_watchlist_minutes INTEGER NOT NULL DEFAULT 30,
  min_buy_confidence INTEGER NOT NULL DEFAULT 85,
  min_sell_confidence INTEGER NOT NULL DEFAULT 80,
  notify_score_change INTEGER NOT NULL DEFAULT 20,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
