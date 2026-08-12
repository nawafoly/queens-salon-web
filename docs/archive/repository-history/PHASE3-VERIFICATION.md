> **ARCHIVED — Historical repository note. This is not an operational instruction or current source of truth.**

# Phase 3 Verification — Queens Salon

Baseline Git commit: `6d837f0`

## Safety state

- No Worker deploy was performed.
- No Firestore-to-D1 data migration was applied.
- No Vercel environment variable was changed.
- `VITE_USE_CORE_D1` and `VITE_USE_PACKAGES_D1` remain `false` unless explicitly enabled.
- D1 failures never fall back automatically to Firestore.
- The new Core schema migration `migrations/core/0002_frontend_cutover.sql` is included but was not applied remotely.

## Implemented

- Explicit frontend data-source flags and diagnostics.
- Typed Core API client with Firebase ID token support, timeout, and normalized errors.
- Typed Core service wrappers for clients, catalog, staff, bookings, invoices, payments, and finance.
- Firestore and Core D1 booking data-source adapters.
- Booking and BookingInternal routed through the compatibility adapter for the targeted Phase 3 operations.
- D1 client and booking search paths for BookingInternal.
- Package/Core cross-database saga: reserve → create Core booking → release on failure.
- Package reservation consumption on Core completion and release on Core cancellation.
- Core Worker public routes required for public catalog and booking creation, while administrative routes still require Firebase authentication.
- Frontend migration guard, documentation, local multi-worker dev script, and tests.
- Core migration mapping for section IDs, public booking IDs, staff display metadata, and specialties.

## Verification

- `npm run check:packages:d1-only` — PASS
- `npm run check:core:d1-only` — PASS
- `npm run check:frontend-core-migration` — PASS
- `npm run test:frontend:core` — PASS (5/5)
- `npm run test:core:worker` — PASS (10/10)
- `npm run test:packages:worker` — PASS (23/23)
- `npm run build` — PASS

Build produced only the existing Vite chunk-size warning.

## Temporary Firestore exceptions

- Slot availability and availability metadata.
- Offers/coupons and app settings.
- Firebase Storage uploads.
- Refund, audit, and income compatibility logic.
- Legacy source selected explicitly while `VITE_USE_CORE_D1=false`.

## Changed files

- `package.json`
- `scripts/migrate-core-firestore-to-d1.mjs`
- `src/pages/Booking.tsx`
- `src/pages/BookingInternal.tsx`
- `src/services/PackageOperationsService.ts`
- `workers/core-worker.test.mjs`
- `workers/core/index.js`
- `workers/core/repositories/bookings.js`
- `workers/core/repositories/clients.js`
- `workers/core/repositories/services.js`
- `workers/core/repositories/staff.js`

## New files

- `.env.phase3.example`
- `docs/frontend-core-cutover.md`
- `migrations/core/0002_frontend_cutover.sql`
- `scripts/check-frontend-core-migration.mjs`
- `scripts/dev-all.mjs`
- `src/config/dataSourceFlags.ts`
- `src/services/CoreBookingService.ts`
- `src/services/CoreCatalogService.ts`
- `src/services/CoreClientService.ts`
- `src/services/CoreFinanceService.ts`
- `src/services/CoreInvoiceService.ts`
- `src/services/CorePaymentService.ts`
- `src/services/CoreStaffService.ts`
- `src/services/bookingDataSource.ts`
- `src/services/bookingDataSourceCompat.ts`
- `src/services/bookingDataSources/coreD1BookingDataSource.ts`
- `src/services/bookingDataSources/firestoreBookingDataSource.ts`
- `src/services/coreApiClient.ts`
- `src/services/coreBookingMappers.ts`
- `src/services/packageBookingSaga.ts`
- `src/types/coreApi.ts`
- `workers/frontend-core-migration.test.mjs`
