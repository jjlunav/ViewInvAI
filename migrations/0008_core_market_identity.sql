PRAGMA foreign_keys = ON;

-- ViewInvAI market identity v2.
-- Instruments are economic assets. Listings are venue-specific quotations.
-- Brokers and providers are separate concerns and must never define instrument identity.

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'market',
  base_url TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL DEFAULT 'stock',
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT '',
  base_currency TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_instruments_type_active
  ON instruments(asset_type, active);
CREATE INDEX IF NOT EXISTS idx_instruments_name
  ON instruments(name);

CREATE TABLE IF NOT EXISTS instrument_identifiers (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL,
  scheme TEXT NOT NULL,
  value TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(instrument_id) REFERENCES instruments(id) ON DELETE CASCADE,
  UNIQUE(scheme, value)
);

CREATE INDEX IF NOT EXISTS idx_instrument_identifiers_instrument
  ON instrument_identifiers(instrument_id, scheme);

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mic TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL,
  session_model TEXT NOT NULL DEFAULT 'REGULAR',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  currency TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  lot_size REAL,
  tick_size REAL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(instrument_id) REFERENCES instruments(id) ON DELETE CASCADE,
  FOREIGN KEY(venue_id) REFERENCES venues(id),
  UNIQUE(venue_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_listings_instrument
  ON listings(instrument_id, active);
CREATE INDEX IF NOT EXISTS idx_listings_venue
  ON listings(venue_id, active);

CREATE TABLE IF NOT EXISTS provider_mappings (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  instrument_id TEXT,
  listing_id TEXT,
  external_id TEXT NOT NULL,
  external_symbol TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_id) REFERENCES data_sources(id),
  FOREIGN KEY(instrument_id) REFERENCES instruments(id) ON DELETE CASCADE,
  FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  CHECK(instrument_id IS NOT NULL OR listing_id IS NOT NULL),
  UNIQUE(source_id, entity_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_mappings_instrument
  ON provider_mappings(instrument_id, source_id);
CREATE INDEX IF NOT EXISTS idx_provider_mappings_listing
  ON provider_mappings(listing_id, source_id);

CREATE TABLE IF NOT EXISTS brokers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broker_listings (
  id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  tradable INTEGER NOT NULL DEFAULT 1 CHECK(tradable IN (0,1)),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  external_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(broker_id) REFERENCES brokers(id) ON DELETE CASCADE,
  FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  UNIQUE(broker_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_broker_listings_listing
  ON broker_listings(listing_id, tradable, verified);

INSERT OR IGNORE INTO data_sources (id,code,name,source_type,base_url,priority) VALUES
  ('source:nasdaq','NASDAQ','Nasdaq','market','https://www.nasdaq.com',10),
  ('source:tradingview','TRADINGVIEW','TradingView','market','https://www.tradingview.com',20),
  ('source:trade-republic','TRADE_REPUBLIC','Trade Republic','market','https://traderepublic.com',10),
  ('source:sec','SEC','SEC EDGAR','official','https://www.sec.gov',10),
  ('source:clinicaltrials','CLINICALTRIALS','ClinicalTrials.gov','official','https://clinicaltrials.gov',10),
  ('source:openfda','OPENFDA','openFDA','official','https://open.fda.gov',10),
  ('source:stocktwits','STOCKTWITS','Stocktwits','social','https://stocktwits.com',50),
  ('source:yahoo-finance','YAHOO_FINANCE','Yahoo Finance','market','https://finance.yahoo.com',40);

INSERT OR IGNORE INTO venues (id,code,name,mic,country_code,currency,timezone,session_model) VALUES
  ('venue:nasdaq','NASDAQ','Nasdaq Stock Market','XNAS','US','USD','America/New_York','US_EXTENDED'),
  ('venue:nyse','NYSE','New York Stock Exchange','XNYS','US','USD','America/New_York','US_EXTENDED'),
  ('venue:amex','AMEX','NYSE American','XASE','US','USD','America/New_York','US_EXTENDED'),
  ('venue:nyse-arca','NYSE_ARCA','NYSE Arca','ARCX','US','USD','America/New_York','US_EXTENDED'),
  ('venue:lsx','LSX','Lang & Schwarz Exchange','','DE','EUR','Europe/Berlin','LSX_CONTINUOUS');

INSERT OR IGNORE INTO brokers (id,code,name,country_code) VALUES
  ('broker:trade-republic','TRADE_REPUBLIC','Trade Republic','DE'),
  ('broker:myinvestor','MYINVESTOR','MyInvestor','ES');
