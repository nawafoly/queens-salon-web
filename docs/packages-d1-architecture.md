# Packages D1 Architecture

## Contract

Session packages have one operational data path:

```text
Frontend -> Packages Worker -> Cloudflare D1
```

The Packages Worker is `queens-salon-packages-api`, configured by `wrangler.packages.jsonc`.

## Operational Source Of Truth

Cloudflare D1 is the only operational database for session packages.

This includes:

- package wallet
- package purchase
- package redeem
- package reserve
- package release
- admin package reports
- package identity aliases
- package transactions

## Firebase Scope

Firebase is allowed only for authentication token verification.

The package system may verify a Firebase ID token to identify the requester and read role claims. It must not use Firestore to resolve wallet balances, package ownership, package catalog entries, package transactions, admin reports, or package mutations.

## Firestore Scope

Firestore is allowed only inside temporary one-time migration scripts.

Allowed example:

- `scripts/migrate-session-packages-firestore-to-d1.mjs`

Not allowed:

- Firestore fallback inside package endpoints
- Firestore reads for wallet loading
- Firestore writes for purchases, redeems, reserves, releases, or admin package reports
- `FirestoreRestClient` inside operational package Worker routes
- `batchGet` or `runQuery` inside the D1 operational path

## No Fallbacks

Do not add a silent fallback from D1 to Firestore.

If `PACKAGES_DB` is missing or unavailable, the Worker must return a clear D1 configuration/storage error. It must not continue by reading from Firebase or Firestore.

Do not use `VITE_PARTNERS_WORKER_URL` as a fallback for packages. The frontend must call the packages worker through `VITE_PACKAGES_WORKER_URL` or the package worker default.

## Future Changes

Any future package change must preserve this path:

```text
Frontend -> Packages Worker -> D1
```

Before merging package changes, run:

```bash
npm run check:packages:d1-only
npm run test:packages:worker
npm run build
```
