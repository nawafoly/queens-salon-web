# Core D1 Architecture

## Operational Path

Queens Salon core operations use this path:

```text
Frontend -> queens-salon-core-api Worker -> Cloudflare D1
```

D1 is the only operational source of truth for:

- clients
- services and service categories
- staff, schedules, leave dates and staff-service mappings
- staff/day availability and booking slot locks
- bookings and booking items
- invoices
- payments
- income and expenses
- discounts, service sections and category relationships
- refunds and audit logs

## Booking availability model

Migration `0003_booking_availability.sql` adds item-level appointment timing,
package reservation references and the `booking_slot_locks` table.

`GET /api/core/availability` reads D1 only. Booking creation validates:

- active staff status
- leave dates
- working-day schedule windows
- slot-step alignment
- interval overlap with active slot locks

The booking, items, invoice and locks are written in one D1 batch. Cancellation
removes the locks; completion preserves them for historical occupancy.

## Firebase Scope

Firebase is used only for authentication token verification and role claims.

The Core Worker must not use Firebase Admin SDK to read operational collections.

## Migration Scope

Firestore is allowed only in one-time migration scripts, such as:

```text
scripts/migrate-core-firestore-to-d1.mjs
```

Migration scripts must be dry-run by default, idempotent when applied, and must
never delete source data. The Core migration preserves legacy item dates,
times, staff links and package references, creates slot locks, synthesizes
required referenced records when possible, and reports identity or slot
conflicts before apply.

## No Fallback

There is no fallback from D1 to Firestore.

If `CORE_DB` is missing or unavailable, the Worker returns a clear D1
configuration/storage error. It must not silently call another Worker,
Firestore, Firebase collections or Vercel functions.

## Cutover Plan

1. Create `queens-salon-core`.
2. Apply `migrations/core`, including `0004_admin_operations.sql`.
3. Run migration dry-run with fixtures and then with production credentials when quota is healthy.
4. Review counts and conflicts.
5. Run migration with `--apply`.
6. Deploy the Core Worker and validate health/availability endpoints.
7. Point frontend Core data flows to `queens-salon-core-api`.
8. Keep Firestore as temporary reference only until validation is complete.

Before merging future Core changes, run:

```bash
npm run verify:phase5
```
