# Final Firestore removal plan

## Current position

Phases 1–6 establish D1/R2 operational paths for packages, booking/core operations, availability, admin finance, HR, settings, role metadata and file metadata. Firebase Authentication remains temporary. Production data migration and feature-flag activation are still blocked by the current Firestore read quota.

The repository still contains legacy Firebase branches. Their presence does not mean D1 mode falls back automatically: selection is explicit through feature flags.

## Remaining inventory

| Area / representative files | Current reason | Classification | Removal plan |
|---|---|---|---|
| `src/services/firebase.ts`, `authService.ts`, `authAccess.ts`, login entry pages | Sign-in, ID token and temporary profile bootstrap | Authentication / temporary role bootstrap | Keep Firebase Auth initially; move operational roles to D1 and later evaluate another identity provider. |
| `bookingDataSources/firestoreBookingDataSource.ts`, `firestoreBookings.ts`, `firestoreCatalog.ts`, `firestoreStaffPublic.ts`, `firestoreOffers.ts` | Explicit legacy adapter when Core D1 flags are false | Legacy operational branch | Remove after Core migration, Worker deploy, smoke tests and production flag cutover. |
| `Booking.tsx`, `BookingInternal.tsx`, public service/offers pages | Some settings, display content or upload paths still use selected legacy adapters | Mixed cutover | Route settings through Core D1 and files through R2; then remove imports after production verification. |
| `employeeHub.ts`, `hrCollections.ts`, `firestoreAttendance.ts`, `firestoreLeaveBalance.ts`, HR pages/components | Existing HR UI still calls legacy services while `VITE_USE_HR_D1=false` | Legacy HR operational branch | Convert each page to `CoreHrService`, verify parity, then delete legacy calls. |
| `attendanceSettingsService.ts`, `attendanceWorkerService.ts`, attendance Workers | Existing attendance worker/settings model | Separate operational subsystem | Decide whether to merge into Core attendance endpoints or retain as a dedicated Cloudflare subsystem backed by D1; eliminate Firestore settings reads. |
| `DashboardEmployees.tsx`, `AdminHrDashboard.tsx`, employee subpages | Large UI surfaces with direct helper/service dependencies | Legacy HR UI | Cut over incrementally behind `VITE_USE_HR_D1`, preserving route permissions and UI. |
| `SettingsUsers.tsx`, `DashboardAdminProfile.tsx`, `userProfile.ts`, `staffAccountLinkService.ts` | Account/profile creation and role data | Auth plus legacy operational metadata | Keep Auth account creation; store admin profile, employee link and roles in D1. Remove Firestore metadata writes after parity tests. |
| `AppSettingsService.ts`, settings pages, `FinanceSettingsService.ts` | Explicit legacy branch while settings flag is false | Legacy settings branch | Enable `VITE_USE_SETTINGS_D1`, migrate setting keys and remove Firestore branch after comparison. |
| File pages and employee file helpers | Firebase Storage and Firestore metadata | Legacy file branch | Create R2 bucket, copy binaries, import metadata, enable `VITE_USE_R2_FILES`, then remove Firebase Storage calls. |
| `ClientPackageService.ts`, `PackageService.ts`, `firestorePackages.ts` and old package transaction modules | Compatibility and one-time migration/audit paths | Legacy package / migration | Keep isolated only until package data is migrated and reconciled; operational package endpoints remain D1-only. |
| Dashboard reports, loyalty, pending, TV queue, logs and day audit pages | Some direct reads remain for reporting compatibility | Legacy reporting branch | Add Core reporting endpoints or derive from D1 tables; remove Firestore reads after totals match. |
| Partner frontend services | Partner subsystem already uses a Cloudflare Worker/D1, but some auth/profile helpers import Firebase | Authentication / separate D1 subsystem | Keep Worker/D1 data; narrow Firebase use to token acquisition only. |
| `scripts/migrate-*-firestore-to-d1.mjs` and audit/repair scripts | One-time source extraction and reconciliation | Migration-only | Retain outside runtime bundles until cutover sign-off, then archive securely. |
| `workers/packages/firestore-rest.js`, `transactions.js`, legacy package tests | Historical migration/compatibility implementation | Non-operational legacy code | Delete or archive after D1 production cutover and final package reconciliation. Runtime D1 guards must continue to pass. |

## Cutover order

1. Restore Firestore reads temporarily or wait for quota reset.
2. Run package and Core migration scripts without `--apply`.
3. Review counts, conflicts, skipped rows and identity mappings.
4. Run idempotent `--apply` migrations.
5. Compare D1 counts and financial/package samples with Firestore.
6. Create R2 bucket and migrate binaries separately.
7. Deploy Packages and Core Workers with D1/R2 bindings.
8. Test with flags enabled in a controlled environment.
9. Enable production flags one subsystem at a time.
10. Monitor Workers, bookings, slot locks, package balances, attendance and payments.
11. Remove legacy branches only after a documented rollback window.

## Flags

```env
VITE_USE_CORE_D1=false
VITE_USE_PACKAGES_D1=false
VITE_USE_HR_D1=false
VITE_USE_SETTINGS_D1=false
VITE_USE_R2_FILES=false
```

A flag set to `true` without a configured Worker/binding must fail explicitly. Runtime errors must never trigger an automatic Firebase fallback.
