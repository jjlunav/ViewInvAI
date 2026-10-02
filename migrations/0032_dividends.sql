-- Dividend payments with foreign and Spanish withholding (Fiscal · IRPF).
CREATE TABLE IF NOT EXISTS dividends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  paid_at TEXT NOT NULL,
  isin TEXT NOT NULL DEFAULT '',
  ticker TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'EUR',
  gross REAL NOT NULL CHECK(gross>0),
  withholding REAL NOT NULL DEFAULT 0 CHECK(withholding>=0),
  withholding_es REAL NOT NULL DEFAULT 0 CHECK(withholding_es>=0),
  origin TEXT NOT NULL DEFAULT 'manual',
  broker TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dividends_external ON dividends(user_id,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dividends_user_date ON dividends(user_id,paid_at);
