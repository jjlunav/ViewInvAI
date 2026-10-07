PRAGMA foreign_keys = ON;

-- D1 read optimisation for the minute scheduler.
-- These indexes do not change analysis cadence or alert logic; they only let SQLite
-- find the same oldest/due rows without scanning user-grouped indexes.

CREATE INDEX IF NOT EXISTS idx_positions_active_analysis_due
  ON positions(active, last_analysis_at, user_id, portfolio_id);

CREATE INDEX IF NOT EXISTS idx_watchlist_analysis_due_global
  ON watchlist(last_analysis_at, user_id);

CREATE INDEX IF NOT EXISTS idx_user_notification_settings_enabled
  ON user_notification_settings(opted_in_explicitly, notifications_enabled, user_id);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_actionable
  ON notification_preferences(user_id, id)
  WHERE news_enabled <> 0
     OR pulse_enabled <> 0
     OR radar_enabled <> 0
     OR price_up_enabled <> 0
     OR price_down_enabled <> 0
     OR price_above IS NOT NULL
     OR price_below IS NOT NULL;
