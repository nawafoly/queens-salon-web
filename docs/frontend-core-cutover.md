# Frontend → Core D1 cutover

## Architecture

- Operational booking data: `Frontend → queens-salon-core-api → CORE_DB`
- Session packages: `Frontend → queens-salon-packages-api → PACKAGES_DB`
- Firebase remains temporarily for authentication and ID-token issuance.
- Core and Packages Workers must never fall back to Firestore.

## Feature flags

```env
VITE_CORE_WORKER_URL=http://127.0.0.1:8807
VITE_PACKAGES_WORKER_URL=http://127.0.0.1:8797
VITE_USE_CORE_D1=false
VITE_USE_PACKAGES_D1=false
```

Flags are `false` by default. Enabling a D1 flag without its Worker URL fails
with an explicit configuration error. A failed D1 request never triggers an
automatic Firestore fallback.

## Migrated frontend operations

- Public booking: services, sections, active staff, staff/day availability,
  booked-slot metadata, booking creation and grouped booking creation.
- Internal booking: the same catalog, staff and availability operations,
  client search, booking search, update, complete and cancel through the
  selected data-source adapter.
- Package wallet and package mutations remain isolated in the Packages Worker.
- D1 mode stores the package reservation transaction reference on the matching
  Core booking item.

## Availability and slot locking

`GET /api/core/availability` is the D1 source for a staff member's day state.
It returns schedule windows, leave status, taken start times and booked-slot
metadata.

Booking creation validates the staff record, leave dates, schedule window,
slot-step alignment and overlapping time ranges. It then writes the booking,
booking items, invoice and `booking_slot_locks` in one D1 batch. Cancelling a
booking removes its slot locks. Completing a booking keeps the locks because
the completed appointment still occupied that historical time.

## Temporary Firebase exceptions

The following remain until later cutover phases: offers/coupons, app settings,
uploads/Storage, refund compatibility, audit/income compatibility, manual
legacy availability backfill and the legacy adapter selected explicitly while
`VITE_USE_CORE_D1=false`.

Direct slot-availability reads from `Booking.tsx` and `BookingInternal.tsx` have
been removed. The legacy Firestore implementation is isolated inside
`firestoreBookingDataSource.ts` and is never used as an automatic fallback from
D1 mode.

## Package booking saga

Cross-database atomicity is not claimed.

1. Reserve package sessions with a deterministic idempotency key.
2. Create the Core booking and store each reservation transaction reference on
   its booking item.
3. Release all successful reservations if booking creation fails.
4. Consume the reservation when the booking is completed.
5. Release the reservation when the booking is cancelled before consumption.

## Cutover prerequisites

1. Apply all Core D1 migrations through `0003_booking_availability.sql`.
2. Migrate and reconcile Core and Packages data.
3. Deploy both Workers.
4. Test against staging URLs.
5. Set the Worker URLs in Vercel.
6. Enable one feature flag at a time.
7. Roll back by setting the relevant flag to `false`; do not add automatic code fallback.
