# D1 architecture v2

ViewInvAI separates four concepts that must never be conflated:

1. **Instrument**: the economic asset/company/fund.
2. **Listing**: a venue-specific quotation of that instrument.
3. **Venue**: NASDAQ, NYSE, LSX, etc.; it defines the session model.
4. **Broker**: Trade Republic, MyInvestor, etc.; it exposes listings to users.

## Market data policy

Live quotes and ticks are not stored continuously in D1. The live path remains provider -> Worker/cache -> UI.

D1 stores identity, relationships, user state, portfolio/accounting state and consolidated session state. listing_session_snapshots records one row per listing/trading date/session and can move through PENDING, LIVE and FINAL.

For US listings, the active session moves Premarket -> Regular -> Postmarket. When a session ends it becomes FINAL; the next session becomes LIVE. LSX has its own venue session model and must never inherit US pre/post data.

## Migration strategy

Legacy stock_key, ticker, exchange and prefer_tr remain during transition. Migration 0011 adds nullable instrument_id and listing_id links. Backfill and dual-write come before any legacy field is removed.

All schema changes must be introduced through versioned files in migrations/. Runtime CREATE TABLE statements are temporary legacy behavior and should be removed once production is fully migration-managed.
