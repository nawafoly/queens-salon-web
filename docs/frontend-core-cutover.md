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

- Public booking: services, sections, active staff, booking creation and grouped booking creation.
- Internal booking: the same catalog/staff/write operations, client search,
  booking search, update, complete and cancel through the data-source adapter.
- Package wallet and package mutations remain isolated in the Packages Worker.

## Temporary Firestore exceptions

The following remain until later cutover phases: slot availability metadata,
offers/coupons, app settings, uploads/Storage, refund compatibility,
audit/income compatibility and legacy reads selected explicitly while the flag
is `false`.

## Package booking saga

Cross-database atomicity is not claimed.

1. Reserve package sessions with a deterministic idempotency key.
2. Create the Core booking.
3. Release all successful reservations if booking creation fails.
4. Consume the reservation when the booking is completed.
5. Release the reservation when the booking is cancelled before consumption.

## Cutover prerequisites

1. Apply all D1 migrations, including `0002_frontend_cutover.sql`.
2. Migrate and reconcile Core and Packages data.
3. Deploy both Workers.
4. Test against staging URLs.
5. Set the Worker URLs in Vercel.
6. Enable one feature flag at a time.
7. Roll back by setting the relevant flag to `false`; do not add automatic code fallback.
