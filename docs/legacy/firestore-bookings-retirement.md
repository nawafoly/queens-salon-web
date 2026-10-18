# Retired Firestore booking runtime

## Decision

The former `src/services/firestoreBookings.ts` is not a runtime entry point.
Public booking, checkout, employee booking statistics, admin booking lists and reporting
now depend on Core D1 services and canonical `src/types/bookingRecord.ts`.
PR #221 centralized DTOs and moved reporting; PR #222 moved employee statistics
and added a recursive source-import regression guard.

## Historical and recovery safeguards

The retired module (last retained on `main` at
`4ad8bf592ed89d1a76880b9f3584895d85b5a81c`) remains accessible in
Git history. It contained Firestore booking/slot/track writes, locking,
legacy availability helpers and `backfillEmployeeKeys`. This history is
for audit and recovery inspection, **not** a runnable production rollback.
Restoring it requires a new reviewed PR, a runtime dependency audit,
and explicit data reconciliation.

One-time migration scripts under `scripts/`, D1 migration records under
`migrations/`, and their safety tests are retained untouched. This change
does not export, delete, migrate, or mutate any Firestore/D1/R2 data.

## Invariants

- Core D1 is the only active booking data source.
- Public tracking is served from the Core API without disclosing private
  booking/admin fields.
- Employee statistics preserve inclusive date filters and booking statuses.
- Calendar availability is authorized by Core HR/availability.
- A test walks the full `src/` tree for forbidden imports of the retired module.
- No deployment of Core Worker is necessary for this frontend-only cleanup.
