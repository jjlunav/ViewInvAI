PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS broker_products (
  id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  listing_id TEXT,
  product_code TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  product_mode TEXT NOT NULL DEFAULT 'unknown'
    CHECK(product_mode IN ('unknown','exchange','fund','savings_plan','otc')),
  currency TEXT NOT NULL DEFAULT '',
  tradable INTEGER NOT NULL DEFAULT 1 CHECK(tradable IN (0,1)),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(broker_id)
    REFERENCES brokers(id)
    ON DELETE CASCADE,

  FOREIGN KEY(instrument_id)
    REFERENCES instruments(id)
    ON DELETE CASCADE,

  FOREIGN KEY(listing_id)
    REFERENCES listings(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_products_listing_unique
  ON broker_products(broker_id, listing_id)
  WHERE listing_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_products_instrument_unique
  ON broker_products(broker_id, instrument_id)
  WHERE listing_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_broker_products_instrument
  ON broker_products(instrument_id, broker_id, tradable, verified);

CREATE INDEX IF NOT EXISTS idx_broker_products_broker
  ON broker_products(broker_id, tradable, verified);

INSERT OR IGNORE INTO broker_products (
  id,
  broker_id,
  instrument_id,
  listing_id,
  product_code,
  external_id,
  product_mode,
  currency,
  tradable,
  verified,
  metadata_json,
  verified_at,
  created_at,
  updated_at
)
SELECT
  'broker-product:' || bl.id,
  bl.broker_id,
  l.instrument_id,
  bl.listing_id,
  l.ticker,
  bl.external_id,
  'exchange',
  l.currency,
  bl.tradable,
  bl.verified,
  bl.metadata_json,
  bl.verified_at,
  bl.created_at,
  bl.updated_at
FROM broker_listings bl
JOIN listings l
  ON l.id = bl.listing_id;
