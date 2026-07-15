# Core D1 Architecture

## Operational Path

Queens Salon core operations use this path:

```text
Frontend -> queens-salon-core-api Worker -> Cloudflare D1
```

D1 is the only operational source of truth for:

- clients
- services and service categories
- staff and staff-service mappings
- bookings and booking items
- invoices
- payments
- income and expenses
- discounts

## Firebase Scope

Firebase is used only for authentication token verification and role claims.

The core worker must not use Firebase Admin SDK to read operational collections.

## Migration Scope

Firestore is allowed only in one-time migration scripts, such as:

```text
scripts/migrate-core-firestore-to-d1.mjs
```

Migration scripts must be dry-run by default, idempotent when applied, and must never delete source data.

## No Fallback

There is no fallback from D1 to Firestore.

If `CORE_DB` is missing or unavailable, the worker returns a clear D1 configuration/storage error. It must not silently call another worker, Firestore, Firebase collections, or Vercel functions.

## Cutover Plan

1. Create `queens-salon-core`.
2. Apply `migrations/core`.
3. Run migration dry-run with fixtures and then with production credentials when quota is healthy.
4. Review counts and conflicts.
5. Run migration with `--apply`.
6. Point frontend core data flows to `queens-salon-core-api`.
7. Keep Firestore as temporary reference only until validation is complete.

Before merging future Core changes, run:

```bash
npm run check:core:d1-only
npm run test:core:worker
npm run build
```
