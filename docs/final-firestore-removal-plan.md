# Final Firestore removal plan

## Current position

Phases 1–6 establish D1/R2 operational paths for packages, booking/core operations, availability, admin finance, HR, settings, role metadata and file metadata. Active frontend packages now route through `/api/core/packages/*` on the Core Worker and `CORE_DB`; the legacy standalone Packages Worker files remain in the repository for separate audit. Firebase Authentication remains temporary. Core booking/admin, HR and settings operational paths are D1-only; remaining migration and feature-flag work is limited to subsystems that still have an active compatibility path.

The repository still contains legacy Firebase branches. Their presence does not mean D1 mode falls back automatically: selection is explicit through feature flags only where a subsystem still has an active flag.

## Remaining inventory

| Area / representative files | Current reason | Classification | Removal plan |
|---|---|---|---|
| `src/services/firebase.ts`, `authService.ts`, `authAccess.ts`, login entry pages | Sign-in, ID token and temporary profile bootstrap | Authentication / temporary role bootstrap | Keep Firebase Auth initially; move operational roles to D1 and later evaluate another identity provider. |
| Retired `firestoreBookings.ts`, maintained `firestoreOffers.ts` | Booking DTOs live in `src/types/bookingRecord.ts`; public/admin booking, reporting and employee statistics use Core D1. Retired Firestore booking implementations remain traceable in Git history for recovery audits, not frontend runtime. | Core-only booking / historical migration | Keep migration and audit scripts; do not reinstate Firestore booking CRUD. See `docs/legacy/firestore-bookings-retirement.md`. |
| `Booking.tsx`, `BookingInternal.tsx`, public service/offers pages | Core booking/settings are D1-only; some display content or upload paths may still use selected legacy adapters | Mixed cleanup | Keep booking/settings Core-backed, route files through R2, then remove legacy imports after production verification. |
| `employeeHub.ts`, `hrCollections.ts`, `firestoreAttendance.ts`, `firestoreLeaveBalance.ts`, HR pages/components | Historical HR helpers remain for migration, audit, or compatibility; the Core HR operational path is D1-only | Legacy HR residue | Verify each remaining callsite, then delete legacy helpers only after proving they are outside the operational runtime. |
| `attendanceSettingsService.ts`, `attendanceWorkerService.ts`, attendance Workers | Existing attendance worker/settings model | Separate operational subsystem | Decide whether to merge into Core attendance endpoints or retain as a dedicated Cloudflare subsystem backed by D1; eliminate Firestore settings reads. |
| `DashboardEmployees.tsx`, `AdminHrDashboard.tsx`, employee subpages | Large UI surfaces with direct helper/service dependencies | HR UI audit surface | Keep runtime HR operations Core-backed; audit remaining direct helper dependencies without reintroducing a source-selection flag. |
| `SettingsUsers.tsx`, `DashboardAdminProfile.tsx`, `userProfile.ts`, `staffAccountLinkService.ts` | Account/profile creation and role data | Auth plus legacy operational metadata | Keep Auth account creation; store admin profile, employee link and roles in D1. Remove Firestore metadata writes after parity tests. |
| `AppSettingsService.ts`, settings pages, `FinanceSettingsService.ts` | Settings reads and writes are Core D1-only and fail closed; historical compatibility references may remain outside runtime | Settings D1-only / legacy residue | Audit and remove remaining non-runtime residue; never reintroduce a settings source-selection flag or Firestore fallback. |
| File pages and employee file helpers | File runtime is Core D1/R2-only; remaining Firebase Storage objects are migration/cleanup artifacts | R2-only / legacy file objects | Keep `CoreFilesService` and Core R2 routes as the sole runtime file path; remove legacy objects only after R2 object and `file_metadata` reconciliation. |
| `ClientPackageService.ts`, `PackageService.ts`, `firestorePackages.ts` and old package transaction modules | Compatibility and one-time migration/audit paths | Legacy package / migration | Keep isolated only until package data is migrated and reconciled; operational package endpoints use Core D1-only routes. |
| Dashboard reports, loyalty, pending, TV queue, logs and day audit pages | Some direct reads remain for reporting compatibility | Legacy reporting branch | Add Core reporting endpoints or derive from D1 tables; remove Firestore reads after totals match. |
| Partner frontend services | Partner subsystem already uses a Cloudflare Worker/D1, but some auth/profile helpers import Firebase | Authentication / separate D1 subsystem | Keep Worker/D1 data; narrow Firebase use to token acquisition only. |
| `scripts/migrate-*-firestore-to-d1.mjs` and audit/repair scripts | One-time source extraction and reconciliation | Migration-only | Retain outside runtime bundles until cutover sign-off, then archive securely. |
| `workers/packages/firestore-rest.js`, `transactions.js`, legacy package tests | Historical migration/compatibility implementation | Non-operational legacy code | Delete or archive after D1 production cutover and final package reconciliation. Runtime D1 guards must continue to pass. |

## Cutover order

1. Restore Firestore reads temporarily or wait for quota reset only when a remaining migration/audit script still requires them.
2. Run package and Core migration scripts without `--apply` when reconciliation work is still required.
3. Review counts, conflicts, skipped rows and identity mappings.
4. Run idempotent `--apply` migrations only after preflight and backup requirements are satisfied.
5. Compare D1 counts and financial/package samples with the legacy source where reconciliation is still pending.
6. Verify R2 storage and reconcile any remaining legacy binaries separately where cleanup is incomplete.
7. Deploy the required Workers with D1/R2 bindings.
8. Verify remaining operational subsystem configuration without restoring retired source-selection flags.
9. Confirm the frontend routes package operations through the Core Worker and no longer configures a separate Packages Worker.
10. Monitor Workers, bookings, slot locks, package balances, attendance and payments.
11. Remove legacy branches only after a documented rollback window.

## Active runtime configuration

`VITE_CORE_WORKER_URL` is the frontend endpoint for Core booking/admin, HR, settings and unified package operations. Files use Core R2 routes. These migrated domains have no runtime data-source selection flags. Runtime errors must never trigger an automatic Firebase fallback.
