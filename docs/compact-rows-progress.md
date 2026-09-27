# Compact rows and quote-session progress

Status: work in progress on `perf/catalogue-and-shared-cards`. Not a release.

## Integrated in this change

- `standardStockCard` is the common identity, quote and detail-row renderer for Home, normal stock portfolio positions, Radar, Future Potential, Calendar and the mobile TR/US catalogues and Ideas IA.
- Per-menu context is passed as a slot. The mobile Ideas IA General view no longer renders the duplicate thesis/factors/news disclosure; the IA tab retains that content.
- Main and extended-session prices have their own matching percentages and colors, with smaller explicitly approximate FX references. Actual LSX quotes are not manufactured from US quotes.
- `selectUsQuoteSessions` orders source-dated evidence, preserves regular and extended legs and does not promote an older PRE over a newer POST. Undated and missing data stay explicit.
- Nasdaq secondary quotes are retained, including during snapshot replacement. Last-trade time is separated from receipt time and bid/ask time.
- Session/snapshot timestamps do not claim exact last-trade precision.
- Session/formatter memoization, visible quote-cell updates, throttled full-list refreshes and avoiding the hidden native leaders dock reduce repeated work. Overall device latency has not yet been benchmarked.
- Radar controls are compact and sticky. Filter button text reflects expanded state.

## Verification

Run `node tests/quote-sessions.test.cjs`: 40 assertions passed locally. Tests cover Friday/Sunday/Monday transitions, source precision, missing values, price/percentage consistency, real LSX versus US fallback, pure-session cache invalidation and shared row adapters. They use synthetic quote fixtures and a fixed reference time; they are not live-provider integration tests.

Offline Chromium layout checks completed for:

- Native presentation, dark, 360 and 390 CSS pixels, using the supplied 6,110-stock snapshot.
- Native presentation, dark, 412 pixels, using a 250-stock/40-event subset.
- Mobile web presentation, light, 360, 390 and 412 pixels, using that subset.

Each configuration checked the seven stock listing screens, pinned Radar controls, filter label, the real portfolio position renderer, General/IA separation, stress-price geometry and uncaught JavaScript errors. The six completed configurations had no failed assertions. These checks use mocked networking/authentication and exclude the funds module, which has a separate WIP implementation. They are not an Android-device test or a full application performance benchmark.

An initial all-configuration browser batch stalled after two completed configurations and was stopped. Remaining targeted configurations were run in fresh processes. No success is claimed for configurations that did not complete.

## Still required before release

- Migrate/review remaining variants: alert history, watchlist/fallback portfolio rows, desktop recommendation/catalogue presentation and fund-position rows.
- Enrich the verified MyInvestor catalogue; no new MyInvestor availability is asserted by this change.
- Implement sourced calendar-year fund returns (2026/2025/2024) and missing costs; do not relabel rolling returns as calendar years.
- Test the stock changes together with the new funds cache, including live data, navigation and actual Android responsiveness.
- Update the existing full frontend smoke expectations for the new funds default tab, then run full CI/security/build validation.
- Bump release assets/version, produce and inspect the APK, and deploy only after the remaining work passes review.
