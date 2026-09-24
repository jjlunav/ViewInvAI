# ViewInvAI backend foundation

This backend is intended to make the mobile app and web app share the same account, portfolios, watchlist, alerts and continuous analysis state.

## Product model

ViewInvAI deliberately separates two concepts:

- **Seguimiento (watchlist):** stocks the user wants to monitor but may not own.
- **Carteras (portfolios):** real positions grouped by broker, with quantity, average entry price and currency.

The analysis vocabulary therefore differs by context:

### Watchlist
- `BUY_CANDIDATE`
- `WATCH`
- `AVOID`

### Owned position
- `HOLD`
- `WATCH_EXIT`
- `SELL`

The app must never infer that a watchlist item is an owned position.

## Intended mobile navigation

The primary mobile tabs should remain stable for muscle memory:

1. **Mercados**
2. **Ideas IA**
3. **Carteras**
4. **Alertas**
5. **Más**

Do not automatically reorder these five tabs. Usage-based ranking may be used inside **Más** only.

Within **Carteras**, show:

- Portfolio list (for example Trade Republic, IBKR, Trade activo).
- Position count and aggregate P/L when enough data is available.
- Latest analysis health for each portfolio.
- A separate **Seguimiento** list for starred stocks that are not necessarily owned.

## Continuous analysis

The browser must not be responsible for background monitoring. A scheduled backend job should evaluate tracked stocks even when the app is closed.

Recommended cadence:

- Owned positions during active market sessions: every 10–15 minutes.
- Watchlist during active market sessions: every 20–30 minutes.
- Outside active sessions: event-driven plus a slower periodic refresh.
- Immediate priority job when a material news/event ingestion changes the source fingerprint.

Only re-run the model when the market/news/event fingerprint changed materially or the current analysis expired.

## Analysis input

Each model evaluation should receive a compact structured payload containing:

- Current quote and session.
- Bid/ask and spread when available.
- Intraday / recent chart summary.
- Trend state, EMA20/EMA50, RSI, ADX.
- Absolute and relative volume.
- Recent and upcoming news/events/catalysts.
- Liquidity warnings.
- For owned positions only: quantity, average entry price, currency and current unrealized P/L.
- Previous analysis signal and reasons so the model can explain what changed.
- Data-quality flags.

Do not send raw, unbounded article bodies or huge chart histories to the model. Pre-compute structured features first.

## Analysis output

Store a strict JSON result and a human-readable summary. The stored `conviction` score is an internal strength score, **not a calibrated probability of success**.

Suggested shape:

```json
{
  "signal": "HOLD",
  "conviction": 84,
  "horizon": "1-2d",
  "present": {
    "bias": "bullish",
    "technical_state": "trend confirmed",
    "liquidity": "acceptable"
  },
  "future": {
    "base_case": "continuation if volume remains above average",
    "bull_case": "breakout above resistance",
    "bear_case": "loss of support invalidates thesis"
  },
  "reasons": ["..."],
  "risks": ["..."],
  "catalysts": ["..."],
  "invalidation": {
    "condition": "...",
    "price": null
  },
  "data_quality": {
    "complete": true,
    "missing": []
  }
}
```

## Notification policy

Notifications are state-change driven, not refresh driven.

Notify when:

- A watchlist stock first becomes a high-conviction `BUY_CANDIDATE`.
- An owned position changes from `HOLD` to `WATCH_EXIT`.
- An owned position changes to `SELL`.
- A material event/news item invalidates or materially changes the thesis.

Do not notify on every scheduled run.

A tap on a notification must deep-link to that stock's complete ViewInvAI analysis.

## Backend components

Planned Cloudflare components:

- **D1:** persistent user, portfolio, watchlist, analysis and alert data.
- **Worker:** authenticated API and scheduled orchestration.
- **Cron trigger:** enqueue/evaluate due analyses.
- **Push provider:** FCM for Android.
- **Google Sign-In:** authentication and account identity.
- **Model provider:** added server-side only. No model key is exposed to the browser or APK.

## Security requirements

- All write endpoints require an authenticated session.
- Google identity tokens are verified server-side.
- The browser receives a short-lived HttpOnly session cookie, not a provider secret.
- Every query is scoped by authenticated `user_id`.
- Push tokens belong to one authenticated user.
- Model/provider API keys are Cloudflare secrets only.
- Never expose D1 directly to the client.

## Deployment order

1. Create D1 database and apply `migrations/0001_portfolios_ai.sql`.
2. Add the D1 binding to `wrangler.jsonc`.
3. Configure Google Sign-In credentials for the final ViewInvAI origin/package.
4. Implement session endpoints.
5. Implement portfolio/watchlist CRUD.
6. Connect the redesigned mobile UI to those endpoints.
7. Add scheduled analysis orchestration and the real model provider.
8. Add FCM device registration and push delivery.
9. Migrate existing local favorites into the user's watchlist after first sign-in.
