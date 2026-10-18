# Packages D1 Architecture

## Contract

Session packages have one active frontend operational data path:

```text
Frontend -> Core Worker (/api/core/packages/*) -> CORE_DB (Cloudflare D1)
```

The Core Worker is `queens-salon-core-api`, configured by `wrangler.core.jsonc`. It reuses the package D1 route/repository modules under `workers/packages/` with unified Core client identities. The historical standalone Packages Worker configuration (`wrangler.packages.jsonc`) remains in the repository but is not the active frontend destination.

## Operational Source Of Truth

`CORE_DB` (Cloudflare D1) is the operational database for session packages.

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

Firebase is allowed only for authentication and a bounded read of the signed-in user's own role profile when the verified ID token does not carry the current role. Package balances, wallets, purchases, redemptions, and reports remain D1-only.

The Core package routes may verify a Firebase ID token to identify the requester and resolve permitted role metadata. It must not use Firestore to resolve wallet balances, package ownership, package catalog entries, package transactions, admin reports, or package mutations.

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

If the Core Worker cannot access `CORE_DB`, package requests must fail explicitly with a configuration/storage error; they must not fall back to Firebase, Firestore or another Worker.

The frontend uses `VITE_CORE_WORKER_URL` and Core package routes. Do not restore the retired standalone Packages Worker URL or use the Partners Worker as a fallback.

## Future Changes

Any future package change must preserve this path:

```text
Frontend -> Core Worker -> CORE_DB
```

Before merging package changes, run:

```bash
npm run check:packages:d1-only
npm run test:packages:worker
node --test workers/core-packages-unification.test.mjs
npm run build
```
