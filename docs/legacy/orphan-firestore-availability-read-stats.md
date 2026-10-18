# Orphan Firestore availability and read-profiler retirement

## Retired frontend modules

- `src/services/firestoreAvailabilityDays.ts` previously mapped Firestore
  `availability_days` booked-slot documents; it lost its only active consumer
  when `firestoreBookings.ts` was retired in PR #223.
- `src/services/firestoreReadStats.ts` previously exposed the development
  `window.__fsReads` profiler; the legacy booking reader was its only
  supported instrumented consumer. It has no live source import.

Both implementations remain recoverable from Git history at
`02484cb10d22d0f1263109191a8560917eafbc3b`.

## Explicitly preserved

- `src/services/firestoreAvailabilityBackfill.ts` remains available as
  **legacy one-time migration tooling**, reachable from the DEV-only
  `firestoreDebug.ts` import in `src/main.tsx`.
- Firebase Authentication and any other Firestore/Functions runtime used by
  unrelated subsystems are unchanged.
- `functions/`, `scripts/`, `migrations/` and their recovery evidence
  are not changed or executed in this cleanup.

Production D1, Cloudflare Worker, R2 and Firebase data are untouched.
Reintroducing an old Firestore booked-slot runtime requires a separately
reviewed change and data-source-of-truth reconciliation.
