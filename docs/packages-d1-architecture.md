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

Firebase ID tokens identify the requester. Core D1 supplies account status, roles, permissions and client ownership. Client wallet and catalog routes resolve the verified Firebase UID against Core, then read trusted legacy aliases for that client. Administrative lookups may use a phone number to find a wallet. Session balance mutations require a stable client identifier or a stored booking reservation.

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

## Replays and accounting

Core checks package mutation authorization before serving an HTTP replay. A replay key is bound to the authorized account, tenant and request. The purchase fingerprint also includes the settlement contract version, so a cached success from before settlement cannot serve as proof of payment. The package repository checks the tenant's sale reference, canonical client, catalog item, payment method and any supplied quote independently of the HTTP key.

The admin purchase action records payment already received by the cashier. It uses the catalog's tax-inclusive price, the tenant's `finance` setting and the Core settled-payment posting path. A single Core D1 batch writes the package, purchase movement, paid invoice, payment, linked income, audit records and sale snapshot. The invoice stores the gross halala total and the sale snapshot retains its tax component. Core's existing Riyadh financial-day triggers protect the entire batch. The server generates invoice and payment IDs. The caller's sale reference is a replay key, including when sent through the legacy `invoiceId` request field.

`0114_package_sale_settlement.sql` adds the sale snapshot table. Historical package references can be acknowledged without mutation and return an unverified settlement status. They do not generate payments or receipts. A separate read-only reconciliation can classify their evidence before any financial remediation.

The administrative identity audit lists bounded, tenant-scoped canonical records and aliases. Its scores and zero-valued relation counts are compatibility fields. The audit does not rank candidates, verify financial relations, or reconcile duplicate identities.

## Future Changes

Any future package change must preserve this path:

```text
Frontend -> Core Worker -> CORE_DB
```

Before merging package changes, run:

```bash
npm run check:packages:d1-only
npm run test:packages:worker
npm run test:packages:worker:integration
node --test workers/core-packages-unification.test.mjs
npm run build
```

The integration command runs the Core HTTP package routes locally with production-derived migrations and an in-memory SQLite D1 adapter. It uses no remote Worker, database, or Firebase emulator.
