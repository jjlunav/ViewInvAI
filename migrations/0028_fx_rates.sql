PRAGMA foreign_keys = ON;

-- Official ECB reference rates (units of currency per 1 EUR), cached for the
-- Spanish tax report: each trade is converted at the rate of its own date.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  rate REAL NOT NULL CHECK(rate > 0),
  PRIMARY KEY(currency, date)
);
