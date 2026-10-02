-- Exact price levels per asset (one-shot: the scheduler clears each level when it fires).
ALTER TABLE notification_preferences ADD COLUMN price_above REAL;
ALTER TABLE notification_preferences ADD COLUMN price_below REAL;
