# Administrative account deletion: runtime ownership and legacy risks

## Canonical live user-facing behavior

The Settings Users screen calls `CoreAccountService.remove(account.id)`.
Core `DELETE /api/admin/accounts/:id` enforces the `accounts.delete`
permission, owner/last-owner protections, and sets the account's
D1 status to `deleted` with `deleted_at`. Core blocks these identities
with `ACCOUNT_DELETED` on subsequent authenticated API access.

**This is a soft delete.** The Firebase Authentication identity is not
physically removed, and the UI explicitly explains that distinction.
Staff/booking/attendance/payroll history is preserved. A worker regression
test validates Core's runtime denial after the soft delete.

## Orphan frontend permanent-delete implementation

The retired `src/services/adminAccountDeletionService.ts` was unreferenced
by the operational UI. It attempted a non-atomic two-step workflow:
1. delete the old `admin_profiles` and role assignments from D1,
2. call Firebase `adminDeleteUserAccount` to delete Firestore documents
   and the Firebase Authentication identity.

A failure after the first step could leave inconsistent identity state.
The old source remains available in Git history under
`d5e36ba40b116e47956a9cae270fc33e8d74e514`.

## Separate backend security and compatibility decision REQUIRED

The callable `functions/src/index.ts:adminDeleteUserAccount` is **not**
removed or modified by this frontend-only patch. Its role checks currently
come from Firebase custom claims / Firestore rather than authoritative
current Core account status and Core permission `accounts.delete`.
A logically deleted Core account may retain a Firebase identity and stale
claims. Thus, **this patch alone does not close that potential authorization
gap for direct callable clients**.

Before retaining, hardening or retiring this deployed callable:
- inventory any external/admin clients or scripts using it;
- require current active Core account identity and Core authorization
  when exposing irreversible Firebase deletion;
- design an idempotent recovery/compensation path for partial failures;
- add backend authorization tests, security review, and a separately
  approved Firebase Functions deployment if backend behavior changes.

No production accounts, Firebase users, Firestore documents, or D1 rows
are mutated by this source-only cleanup.

## Security hardening after the initial PR #230

- A generic Core account PATCH previously accepted `status=deleted` with
  `accounts.update` (or compatibility `admin_accounts.manage`), bypassing
  the separate `accounts.delete` permission. The repository now reserves
  transitions into deleted state for the dedicated DELETE service operation.
- Deleted-account reactivation is restricted to the dedicated Core restore route;
  an ordinary PATCH cannot bypass the separate restore authorization.
- Self-delete is refused by canonical Core logic.
- Package authorization contexts are re-read from D1 for each request, so
  disabled/deleted accounts cannot reuse a 30-second in-memory role cache.
- The historical Firebase callable keeps its symbol but rejects irreversible
  identity deletion; its Firestore/custom-claim checks were insufficient to
  establish current Core authority. External consumers (if any) must migrate
  to the Core soft-delete lifecycle. This is a compatibility change requiring
  an explicit Firebase Functions deployment; code merge alone does not secure
  an already deployed Firebase callable.
- Permanent Firebase identity erasure remains intentionally unimplemented:
  introduce it only with a Core-authorized idempotent job, tenant fencing,
  retry tracking, security logs and a reconciliation plan.

These tests use isolated D1 fixtures; no production records are modified.
