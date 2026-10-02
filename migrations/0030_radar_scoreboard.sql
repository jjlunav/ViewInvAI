PRAGMA foreign_keys = ON;

-- Radar AI scoreboard: one row per stock and trading day when it is in a Radar tier at
-- the daily mark (15:45 New York), with forward returns filled 1, 5 and 20 trading days later.
CREATE TABLE IF NOT EXISTS radar_signals (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  stock_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL,
  score REAL NOT NULL,
  quality REAL NOT NULL,
  price REAL NOT NULL CHECK(price > 0),
  bench_price REAL,
  tr_tradable INTEGER NOT NULL DEFAULT 0,
  speculative INTEGER NOT NULL DEFAULT 0,
  ret_1d REAL, ret_5d REAL, ret_20d REAL,
  bench_1d REAL, bench_5d REAL, bench_20d REAL,
  created_at TEXT NOT NULL,
  UNIQUE(day, stock_key)
);
CREATE INDEX IF NOT EXISTS idx_radar_signals_day ON radar_signals(day);

-- Daily mark of the benchmark (SPY) at the same time as the signals.
CREATE TABLE IF NOT EXISTS radar_bench (
  day TEXT PRIMARY KEY,
  price REAL NOT NULL CHECK(price > 0),
  created_at TEXT NOT NULL
);
