PRAGMA foreign_keys = ON;

ALTER TABLE portfolio_market_settings
  ADD COLUMN cash_balance REAL NOT NULL DEFAULT 0 CHECK(cash_balance>=0);
