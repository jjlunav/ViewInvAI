PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_positions_portfolio_stock;

CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_portfolio_identity
  ON positions(portfolio_id, stock_key, broker, currency, prefer_tr, exchange);

ALTER TABLE transactions ADD COLUMN position_id TEXT NOT NULL DEFAULT '';

UPDATE transactions
SET position_id = COALESCE((
  SELECT p.id
  FROM positions p
  WHERE p.user_id = transactions.user_id
    AND p.portfolio_id = transactions.portfolio_id
    AND p.stock_key = transactions.stock_key
  ORDER BY p.updated_at DESC
  LIMIT 1
), '')
WHERE position_id = '';

CREATE INDEX IF NOT EXISTS idx_transactions_position
  ON transactions(user_id, position_id, executed_at, created_at);
