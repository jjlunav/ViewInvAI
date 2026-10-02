-- Broker ids for imported fund / ETF operations (Trade Republic CSV): re-importing never duplicates.
ALTER TABLE fund_transactions ADD COLUMN external_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_transactions_external ON fund_transactions(user_id,external_id) WHERE external_id<>'';
