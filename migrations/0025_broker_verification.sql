PRAGMA foreign_keys = ON;

ALTER TABLE user_brokers ADD COLUMN canonical_name TEXT NOT NULL DEFAULT '';
ALTER TABLE user_brokers ADD COLUMN official_domain TEXT NOT NULL DEFAULT '';
ALTER TABLE user_brokers ADD COLUMN pricing_url TEXT NOT NULL DEFAULT '';
ALTER TABLE user_brokers ADD COLUMN plan TEXT NOT NULL DEFAULT '';
ALTER TABLE user_brokers ADD COLUMN fee_rules_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE user_brokers ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE user_brokers ADD COLUMN last_verified_at TEXT;
ALTER TABLE user_brokers ADD COLUMN source_excerpt TEXT NOT NULL DEFAULT '';
