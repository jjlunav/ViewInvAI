PRAGMA foreign_keys = ON;

ALTER TABLE positions ADD COLUMN instrument_id TEXT REFERENCES instruments(id);
ALTER TABLE positions ADD COLUMN listing_id TEXT REFERENCES listings(id);

ALTER TABLE watchlist ADD COLUMN instrument_id TEXT REFERENCES instruments(id);
ALTER TABLE watchlist ADD COLUMN listing_id TEXT REFERENCES listings(id);

ALTER TABLE transactions ADD COLUMN instrument_id TEXT REFERENCES instruments(id);
ALTER TABLE transactions ADD COLUMN listing_id TEXT REFERENCES listings(id);

ALTER TABLE notification_preferences ADD COLUMN instrument_id TEXT REFERENCES instruments(id);
ALTER TABLE notification_preferences ADD COLUMN listing_id TEXT REFERENCES listings(id);

ALTER TABLE analysis_snapshots ADD COLUMN instrument_id TEXT REFERENCES instruments(id);
ALTER TABLE analysis_snapshots ADD COLUMN listing_id TEXT REFERENCES listings(id);

ALTER TABLE alert_events ADD COLUMN instrument_id TEXT REFERENCES instruments(id);
ALTER TABLE alert_events ADD COLUMN listing_id TEXT REFERENCES listings(id);

ALTER TABLE fund_positions ADD COLUMN instrument_id TEXT REFERENCES instruments(id);
ALTER TABLE fund_positions ADD COLUMN listing_id TEXT REFERENCES listings(id);

ALTER TABLE fund_transactions ADD COLUMN instrument_id TEXT REFERENCES instruments(id);
ALTER TABLE fund_transactions ADD COLUMN listing_id TEXT REFERENCES listings(id);

CREATE INDEX IF NOT EXISTS idx_positions_instrument_listing
  ON positions(instrument_id, listing_id, active);
CREATE INDEX IF NOT EXISTS idx_watchlist_instrument_listing
  ON watchlist(user_id, instrument_id, listing_id);
CREATE INDEX IF NOT EXISTS idx_transactions_instrument_listing
  ON transactions(user_id, instrument_id, listing_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_pref_listing
  ON notification_preferences(user_id, listing_id);
CREATE INDEX IF NOT EXISTS idx_analysis_listing
  ON analysis_snapshots(user_id, listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_listing
  ON alert_events(user_id, listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fund_positions_instrument
  ON fund_positions(user_id, instrument_id, active);
CREATE INDEX IF NOT EXISTS idx_fund_transactions_instrument
  ON fund_transactions(user_id, instrument_id, executed_at DESC);
