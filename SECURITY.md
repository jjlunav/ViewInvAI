# Security policy

ViewInvAI uses public client configuration for its web and Android clients, but private credentials must never be committed.

## Never commit

- Cloudflare API tokens, account secrets, R2 credentials or Worker secrets.
- Firebase service-account JSON or private keys.
- GitHub personal access tokens.
- Android signing keystores or private-key material.
- Local environment files, Wrangler local state, certificates or private keys.
- Password-bearing database URLs, webhook secrets or third-party API secrets.

Production secrets belong in provider secret stores such as Cloudflare Worker secrets or GitHub Actions secrets.

## Firebase client configuration

The web and Android clients contain Firebase client configuration. These identifiers are not server credentials, but their Google/Firebase API access should be restricted to the intended applications, domains, package name and required APIs.

## Android signing

The stable Android signing keystore should be stored in a repository Actions secret. The workflow keeps a restore-only legacy cache fallback temporarily so existing APK installations continue to receive compatible updates during migration. Once the secret has been verified, delete the legacy signing cache.

## Reporting

Do not open public issues containing credentials or exploit details. Revoke or rotate exposed credentials first, then remediate privately.
