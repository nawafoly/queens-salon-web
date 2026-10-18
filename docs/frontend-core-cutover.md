# Frontend → Core D1 cutover

## Architecture

- Operational booking data: `Frontend → queens-salon-core-api → CORE_DB`
- Session packages: `Frontend → queens-salon-core-api (/api/core/packages/*) → CORE_DB`
- Firebase remains temporarily for authentication and ID-token issuance.
- Core booking and package routes must never fall back to Firestore; the standalone Packages Worker configuration is retained in the repository but is not the active frontend package destination.

## Runtime configuration

```env
VITE_CORE_WORKER_URL=http://127.0.0.1:8807
```

Core booking, admin and package operations have no runtime source-selection flag. `VITE_CORE_WORKER_URL` is required for these requests; active web/staff builds do not configure a separate Packages Worker. A failed D1 request never triggers an automatic Firestore fallback.

## Migrated frontend operations

- Public booking: services, sections, active staff, staff/day availability,
  booked-slot metadata, booking creation and grouped booking creation.
- Internal booking: the same catalog, staff and availability operations,
  client search, booking search, update, complete and cancel through the
  Core D1 data-source adapter.
- Package wallet and mutations use `/api/core/packages/*` in the Core Worker,
  which reuses the package D1 repository against `CORE_DB`.
- Package reservation transaction references are stored on the matching
  Core booking items.

## Availability and slot locking

`GET /api/core/availability` is the D1 source for a staff member's day state.
It returns schedule windows, leave status, taken start times and booked-slot
metadata.

Booking creation validates the staff record, leave dates, schedule window,
slot-step alignment and overlapping time ranges. It then writes the booking,
booking items, invoice and `booking_slot_locks` in one D1 batch. Cancelling a
booking removes its slot locks. Completing a booking keeps the locks because
the completed appointment still occupied that historical time.

## Phase 5 admin operations

Clients, sections/categories, offers/coupons, income, expenses, refunds, audit logs and guarded booking deletion now have explicit Core D1 paths. Refunds use a dedicated ledger and are voided rather than hard-deleted.

## Temporary Firebase exceptions

Firebase Authentication and role/profile lookup plus remaining explicitly audited compatibility paths may still use Firebase. Binary file uploads/downloads are Core R2-only and `src/services/firebase.ts` must not initialize a Firebase Storage client. Active booking, HR and settings operations are Core D1-backed; historical helpers or adapters must not become a runtime source-selection path. Core booking rescheduling uses its dedicated Core endpoint.

Direct slot-availability reads from `Booking.tsx` and `BookingInternal.tsx` have
been removed. The legacy Firestore implementation is isolated inside
`firestoreBookingDataSource.ts` and is never used as an automatic fallback from
Core D1.

## Package booking saga

Packages and bookings are routed through the same Core Worker and `CORE_DB`. This document does not assert end-to-end transaction atomicity for the steps below.

1. Reserve package sessions with a deterministic idempotency key.
2. Create the Core booking and store each reservation transaction reference on
   its booking item.
3. Release all successful reservations if booking creation fails.
4. Consume the reservation when the booking is completed.
5. Release the reservation when the booking is cancelled before consumption.

## Current cutover verification

1. Verify the applied Core migrations, including the package unification schema, before any new migration.
2. Confirm package catalog, wallets, transactions and client identity mappings are reconciled in `CORE_DB` before any data cleanup.
3. Verify Core Worker package routes and the active `CORE_DB` binding in staging and Production.
4. Run `npm run check:packages:d1-only`, `node --test workers/core-packages-unification.test.mjs` and `npm run build`.
5. Keep `VITE_CORE_WORKER_URL` pointing at the Core Worker; do not restore package source flags or standalone package URLs in active frontend modes.
6. Roll back through a controlled deployment/configuration procedure, never an automatic Firestore fallback.
