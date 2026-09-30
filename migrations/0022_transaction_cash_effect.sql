PRAGMA foreign_keys = ON;

ALTER TABLE transactions
  ADD COLUMN cash_delta REAL NOT NULL DEFAULT 0;

ALTER TABLE transactions
  ADD COLUMN cash_currency TEXT NOT NULL DEFAULT '';
