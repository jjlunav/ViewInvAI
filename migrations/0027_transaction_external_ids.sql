PRAGMA foreign_keys = ON;

-- Broker imports (Trade Republic CSV, IBKR Flex): the broker's own id for each
-- execution, so importing the same file or syncing twice never duplicates trades.
ALTER TABLE transactions
  ADD COLUMN external_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external
  ON transactions(user_id, external_id)
  WHERE external_id <> '';
