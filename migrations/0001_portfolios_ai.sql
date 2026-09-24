PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  locale TEXT DEFAULT 'es-ES',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  broker TEXT,
  base_currency TEXT NOT NULL DEFAULT 'EUR',
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id, archived, sort_order);

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  exchange TEXT,
  isin TEXT,
  tr_isin TEXT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  average_entry_price REAL NOT NULL CHECK (average_entry_price >= 0),
  entry_currency TEXT NOT NULL DEFAULT 'EUR',
  opened_at TEXT,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_positions_portfolio ON portfolio_positions(portfolio_id, active);
CREATE INDEX IF NOT EXISTS idx_positions_user_stock ON portfolio_positions(user_id, stock_key, active);

CREATE TABLE IF NOT EXISTS watchlist_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  exchange TEXT,
  isin TEXT,
  tr_isin TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, stock_key)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user_priority ON watchlist_items(user_id, priority DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('watchlist','position','idea')),
  portfolio_id TEXT REFERENCES portfolios(id) ON DELETE SET NULL,
  position_id TEXT REFERENCES portfolio_positions(id) ON DELETE SET NULL,
  signal TEXT NOT NULL CHECK (signal IN (
    'BUY_CANDIDATE','WATCH','AVOID',
    'HOLD','WATCH_EXIT','SELL'
  )),
  conviction INTEGER NOT NULL CHECK (conviction BETWEEN 0 AND 100),
  horizon TEXT NOT NULL DEFAULT '1-2d',
  market_state TEXT,
  current_price REAL,
  entry_price REAL,
  unrealized_pct REAL,
  summary TEXT NOT NULL,
  present_json TEXT NOT NULL DEFAULT '{}',
  future_json TEXT NOT NULL DEFAULT '{}',
  reasons_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  catalysts_json TEXT NOT NULL DEFAULT '[]',
  invalidation_json TEXT NOT NULL DEFAULT '{}',
  data_quality_json TEXT NOT NULL DEFAULT '{}',
  source_fingerprint TEXT NOT NULL,
  model_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_user_stock ON analysis_snapshots(user_id, stock_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_position ON analysis_snapshots(position_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_portfolio ON analysis_snapshots(portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_state (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_key TEXT NOT NULL,
  latest_snapshot_id TEXT REFERENCES analysis_snapshots(id) ON DELETE SET NULL,
  latest_signal TEXT,
  latest_conviction INTEGER,
  last_material_hash TEXT,
  last_notified_signal TEXT,
  last_notified_conviction INTEGER,
  last_notified_at TEXT,
  next_due_at TEXT,
  last_run_at TEXT,
  PRIMARY KEY (user_id, stock_key)
);

CREATE INDEX IF NOT EXISTS idx_analysis_due ON analysis_state(next_due_at);

CREATE TABLE IF NOT EXISTS user_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_key TEXT NOT NULL,
  analysis_id TEXT REFERENCES analysis_snapshots(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'BUY_CANDIDATE','WATCH_EXIT','SELL','MATERIAL_EVENT','ANALYSIS_CHANGE'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON user_alerts(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('android','web')),
  push_token TEXT,
  app_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, platform, push_token)
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, enabled);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_pending ON analysis_jobs(status, priority DESC, requested_at);
