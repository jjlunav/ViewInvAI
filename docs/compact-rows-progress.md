# Compact rows and quote-session progress

Status: work in progress on `perf/catalogue-and-shared-cards`. Not a release.

## Integrated

- `standardStockCard` is the common identity, quote and detail-row renderer for Home, normal stock portfolio positions, Radar, Future Potential, Calendar and the mobile TR/US catalogues and Ideas IA.
- Menu context is passed as a slot. Mobile Ideas IA General no longer repeats thesis/factors/news; the IA tab retains that content.
- Main and extended-session prices have matching percentages and colors, with smaller explicitly approximate FX references. US conversions are not represented as actual LSX quotes.
- `selectUsQuoteSessions` orders source-dated evidence and preserves regular and latest extended legs. An older PRE cannot replace a later POST or appear below a later close as if it were current. Missing values remain explicit.
- Nasdaq secondary quotes survive snapshot replacement. Source last-trade time is separated from receipt and bid/ask time. Session-bar timestamps do not claim exact last-trade precision.
- Session/formatter memoization, visible quote updates, throttled full-list refreshes and skipping the hidden native leaders dock reduce repeated work. Device latency is not yet benchmarked.
- Radar controls are compact and sticky. Filter-button wording follows expanded state.

## Verification

`node tests/quote-sessions.test.cjs`: 41 assertions passed locally, covering Friday/Sunday/Monday transitions, source precision, missing values, price/percentage consistency, LSX versus US fallback, cache invalidation and shared-row adapters. Synthetic fixtures and a fixed reference time are used; this is not a live-feed integration test.

Final offline Chromium checks passed in six configurations: native presentation/dark and mobile web/light, each at 360, 390 and 412 CSS pixels. The final runs use a 250-stock/40-event subset of the supplied snapshot, mocked networking/authentication and actual stock/portfolio rendering scripts. The six completed runs contain 91 passed assertions and no failed assertions, including seven stock listing views, Radar pinning, filter wording, normal portfolio-position rendering, General/IA separation, stress-price geometry and uncaught JavaScript errors. Native 390 also checks the copy-ISIN event path.

The funds module is excluded from this stock-only browser harness. Native means native presentation rendered in Chromium, not execution on an Android device. The full application, authentication, real live feeds and device performance are not validated by these tests.

Earlier 360/390 native runs used the full 6,110-stock snapshot. One combined browser batch stalled and was stopped; final targeted configurations were rerun in fresh processes. No success is claimed for incomplete runs.

## Required before release

- Review/migrate remaining variants: alert history, portfolio watchlist/fallback rows, desktop recommendation/catalogue presentation and fund positions.
- Expand verified MyInvestor coverage; this change adds no new availability claims.
- Source calendar-year fund returns (2026/2025/2024) and missing costs. Rolling returns must not be relabelled as calendar years.
- Test stock changes together with the new funds cache and real navigation/live data on Android.
- Update the existing full frontend smoke expectations for the new funds default tab; run full CI/security/build validation.
- Bump assets/version, build and inspect the APK, then deploy after the remaining work passes review.
