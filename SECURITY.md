# Security policy

ViewInvAI is published from a public source repository. Public client
configuration is not treated as a server credential, but private credentials
must never be committed.

## Never commit

- Cloudflare API tokens, account secrets, R2 credentials or Worker secrets.
- Firebase service-account JSON or private keys.
- GitHub personal access tokens.
- Android signing keystores or their private-key material.
- `.env`, `.dev.vars`, local Wrangler state, certificates or private keys.
- Password-bearing database URLs, webhook secrets or third-party API secrets.

Production secrets belong in the provider secret store (Cloudflare Worker
secrets or GitHub Actions secrets as appropriate).

## Public Firebase client configuration

`auth.js` and `firebase/google-services.json` contain Firebase client
configuration required by the web/Android clients. These identifiers are not
server credentials. Their corresponding Google/Firebase API access must still
be restricted to the intended applications, domains, package name and enabled
APIs.

## Android signing

The stable Android signing keystore must be stored as the repository secret
`ANDROID_DEBUG_KEYSTORE_BASE64`. The workflow currently retains a
restore-only legacy cache fallback solely to preserve update compatibility
until the existing keystore has been migrated. After migration and validation,
the legacy Actions cache must be deleted.

## Reporting

Do not open a public issue containing a credential or exploit detail. Revoke or
rotate exposed credentials first, then use a private security-reporting channel
for remediation.
