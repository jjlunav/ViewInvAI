PRAGMA foreign_keys = ON;

ALTER TABLE user_settings ADD COLUMN notify_news INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_settings ADD COLUMN news_min_impact INTEGER NOT NULL DEFAULT 60;
