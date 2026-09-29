PRAGMA foreign_keys = ON;

ALTER TABLE user_notification_settings
  ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK(notifications_enabled IN (0,1));

ALTER TABLE user_notification_settings
  ADD COLUMN radar_enabled INTEGER NOT NULL DEFAULT 1 CHECK(radar_enabled IN (0,1));

ALTER TABLE user_notification_settings
  ADD COLUMN price_enabled INTEGER NOT NULL DEFAULT 1 CHECK(price_enabled IN (0,1));

ALTER TABLE user_notification_settings
  ADD COLUMN portfolio_enabled INTEGER NOT NULL DEFAULT 1 CHECK(portfolio_enabled IN (0,1));
