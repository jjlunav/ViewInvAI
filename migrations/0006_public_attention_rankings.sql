PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS public_attention_rankings (
  kind TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
