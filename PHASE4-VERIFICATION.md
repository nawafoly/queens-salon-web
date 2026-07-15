# Phase 4 verification

## Scope completed

Phase 4 completes the D1 booking-availability path without deploying or
changing production feature flags.

- Added Core migration `0003_booking_availability.sql`.
- Added D1 staff/day availability endpoint.
- Added interval-based booking slot locks.
- Added schedule, leave and slot-step validation during booking creation.
- Added per-item booking date/time fields for grouped bookings.
- Added package reservation transaction references to Core booking items.
- Routed public and internal booking availability through `bookingDataSource`.
- Isolated the temporary Firestore availability adapter behind the explicit
  legacy feature-flag choice.
- Expanded the one-time Core migration to preserve appointment timing and
  generate D1 slot locks.

## Important runtime behavior

- D1 failure does not trigger Firestore fallback.
- Booking cancellation releases D1 slot locks.
- Booking completion keeps historical locks.
- Same booking ID retries are idempotent.
- Overlapping ranges are rejected; adjacent appointments are allowed.
- Package/Core cross-database work remains a Saga, not a claimed atomic
  transaction.

## Validation results

```text
Package D1-only guard: PASS
Core D1-only guard: PASS
Frontend cutover guard: PASS
Packages tests: 23/23 PASS
Core tests: 18/18 PASS
Frontend/Core tests: 8/8 PASS
TypeScript + Vite build: PASS
Core migration fixture dry-run: PASS
Core migrations 0001-0003 on local D1: PASS
```

The Vite chunk-size warning remains informational and does not fail the build.

## Not performed

- No Worker deployment.
- No remote application of migration `0003`.
- No Firestore-to-D1 production migration.
- No Vercel environment changes.
- No feature flags enabled.

## Production prerequisite still blocked

Production source migration remains blocked until Firestore permits a one-time
read. The current failure is `RESOURCE_EXHAUSTED: Quota exceeded`.
