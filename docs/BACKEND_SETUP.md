# ViewInvAI backend setup

This repository contains the backend code for:

- Google/Firebase authenticated users.
- Portfolios grouped by broker.
- Active positions with quantity and average entry price.
- Watchlist/favorites.
- Periodic AI analysis of positions and watched stocks.
- Analysis history and material-change alerts.
- Android push-device registration (FCM delivery is the next step).

## 1. Create the Cloudflare D1 database

Create one D1 database named `viewinvai-db` in the same Cloudflare account as the Worker.

CLI equivalent:

```bash
npx wrangler d1 create viewinvai-db
```

Cloudflare returns a database UUID. Add it to `wrangler.jsonc`:

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "viewinvai-db",
    "database_id": "<D1_DATABASE_UUID>",
    "migrations_dir": "migrations"
  }
]
```

Apply the schema:

```bash
npx wrangler d1 migrations apply viewinvai-db --remote
```

The Worker already has a Workers AI binding named `AI` and a cron trigger every five minutes.

## 2. Create Firebase project / Google Sign-In

Create a Firebase project for ViewInvAI and enable **Authentication > Sign-in method > Google**.

Register:

- Web app for the browser version.
- Android app with package: `com.viewinvai.mobile`.

For Android Google Sign-In, Firebase also needs the SHA-1 certificate fingerprint of the stable ViewInvAI debug signing key. The Android build workflow prints it so it can be copied into Firebase.

Download `google-services.json` after the Android app is registered. Do not commit production credentials or service-account private keys to the repository.

## 3. Configure Worker authentication

Set the non-secret Firebase project id as a Worker variable:

```json
"vars": {
  "AI_MODEL": "@cf/meta/llama-3.1-8b-instruct",
  "FIREBASE_PROJECT_ID": "<firebase-project-id>"
}
```

The Worker validates Firebase ID tokens cryptographically and does not trust user IDs supplied by the client.

## 4. Current API

All endpoints except `/api/backend/status` require:

```
Authorization: Bearer <firebase-id-token>
```

Available endpoints:

- `GET /api/backend/status`
- `GET /api/me`
- `GET|POST /api/portfolios`
- `PATCH|DELETE /api/portfolios/:id`
- `GET|POST /api/positions`
- `PATCH|DELETE /api/positions/:id`
- `GET|POST /api/watchlist`
- `PATCH|DELETE /api/watchlist/:id`
- `GET /api/analysis?stockKey=...&limit=...`
- `POST /api/analysis/run`
- `GET /api/alerts`
- `POST /api/alerts/read`
- `GET|PATCH /api/settings`
- `GET|POST /api/devices`
- `DELETE /api/devices/:id`

## 5. Monitoring policy

The scheduled Worker runs every five minutes but only analyses items when due:

- Active portfolio positions: normally every 10 minutes.
- Watchlist/favorites: normally every 30 minutes.
- At most 8 analyses are executed per scheduled run.

Each analysis combines:

- current market snapshot;
- intraday chart/history;
- price momentum;
- volume and relative volume;
- RSI, ADX, EMA20 and EMA50;
- recent news/events/catalysts;
- position context such as average entry price when available.

Workers AI produces the contextual assessment. A deterministic rules engine is retained as a fallback and is explicitly labelled as such in the stored snapshot.

For owned positions the AI output is constrained to `HOLD`, `REVIEW` or `SELL`.
For watchlist entries it is constrained to `BUY`, `WATCH` or `AVOID`.

Alerts are generated only for material changes, for example:

- high-confidence SELL / REVIEW on an owned position;
- a large deterioration in score;
- high-confidence BUY on a watched stock;
- a large improvement in a watched stock.

## 6. Next implementation step

Once D1 and Firebase are connected, the mobile/web UI will be wired to:

1. Sign in with Google.
2. Create portfolios by broker.
3. Add/update positions.
4. Convert favorites into synced watchlist entries.
5. Show the latest AI state on every position/favorite.
6. Register the Android FCM token.
7. Deliver push notifications for material AI changes.
