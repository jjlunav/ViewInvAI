PRAGMA foreign_keys = ON;

-- «Catalizadores mañana»: reminder the evening before earnings, FDA or clinical
-- dates of positions and favourites. Starts as the user's «Noticias y eventos» choice.
ALTER TABLE user_notification_settings
  ADD COLUMN catalyst_eve_enabled INTEGER NOT NULL DEFAULT 0 CHECK(catalyst_eve_enabled IN (0,1));

UPDATE user_notification_settings SET catalyst_eve_enabled = news_events_enabled;
