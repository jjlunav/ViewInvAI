PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS listing_session_snapshots (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  trading_date TEXT NOT NULL,
  session_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','LIVE','FINAL')),
  currency TEXT NOT NULL,
  open_price REAL,
  high_price REAL,
  low_price REAL,
  last_price REAL,
  close_price REAL,
  reference_price REAL,
  change_amount REAL,
  change_pct REAL,
  volume REAL,
  source_id TEXT,
  source_timestamp TEXT,
  started_at TEXT,
  finalized_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  FOREIGN KEY(source_id) REFERENCES data_sources(id),
  UNIQUE(listing_id, trading_date, session_code)
);

CREATE INDEX IF NOT EXISTS idx_listing_session_snapshots_listing_date
  ON listing_session_snapshots(listing_id, trading_date DESC, session_code);
CREATE INDEX IF NOT EXISTS idx_listing_session_snapshots_status
  ON listing_session_snapshots(status, trading_date, listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_session_snapshots_source_time
  ON listing_session_snapshots(source_id, source_timestamp);
