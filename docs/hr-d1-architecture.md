# Queens Salon HR on Core D1

## Operational boundary

Phase 6 introduces the D1 operational model for HR. The intended production path is:

```text
Frontend HR adapter -> queens-salon-core-api -> CORE_DB
```

Firebase is permitted only to authenticate the user and supply an ID token. The Core Worker verifies that token, then resolves the operational role from `role_assignments` in D1. No HR endpoint may fall back to Firestore.

The frontend flag remains disabled until production data has been migrated:

```env
VITE_USE_HR_D1=false
```

When enabled, missing Worker configuration is a hard configuration error rather than a reason to read Firestore.

## D1 schema

Migration `migrations/core/0005_hr_settings_files.sql` adds:

- `employee_profiles`
- `employee_employment`
- `hr_work_schedules`
- `attendance_records`
- `attendance_state`
- `employee_leaves`
- `employee_absences`
- `payroll_periods`
- `payroll_entries`
- `admin_profiles`
- `role_assignments`
- `notification_records`

Money is stored in halalas. JSON snapshot columns are used only where historical payroll or schedule snapshots must remain immutable.

## Core endpoints

The Worker exposes D1-backed endpoints for:

- employee profile and employment CRUD
- employee schedules
- attendance listing, check-in, check-out and current state
- leave requests, approval and rejection
- absence records
- payroll periods and payroll entries
- admin profiles and role metadata

Attendance writes use idempotency keys. A duplicate retry does not create an additional attendance event. Approved leave updates the operational staff leave state used by booking availability.

## Frontend adapter

`src/services/CoreHrService.ts` is the typed frontend client. Existing HR pages are not silently redirected. They must explicitly choose the D1 adapter through `VITE_USE_HR_D1=true`; legacy branches remain temporary until each page is cut over and production data is present.

## Migration

`scripts/migrate-core-firestore-to-d1.mjs` remains dry-run by default. Phase 6 mapping includes employee/admin profiles, employment, schedules, attendance, leave, absence, payroll, settings, role assignments, notification records and file metadata.

The source migration is currently blocked by the exhausted Firestore quota. No `--apply` should run before reviewing dry-run counts, conflicts and skipped records.

## Invariants

- `workers/core/**` is D1-only for operational data.
- Firebase Admin/Firestore clients are forbidden in the Core Worker.
- Authentication does not authorize an operational role by itself; D1 role metadata is evaluated after token verification.
- D1 failure returns an explicit error. There is no operational Firestore fallback.
