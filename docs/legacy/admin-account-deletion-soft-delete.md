# Admin account deletion runtime: Core-owned soft delete

The active admin settings page calls `CoreAccountService.remove(account.id)` and
Core D1 updates account status to `deleted`, with account/owner safety checks
and audit through Core repositories. This is a **logical account deletion**,
not a claim that Firebase Authentication is permanently removed.

A separate unused frontend module, `adminAccountDeletionService.ts`, mixed a
Core admin-profile DELETE with a Firebase `adminDeleteUserAccount` callable.
It had no active import and allowed partial completion if the subsequent Auth
step failed. It is retired here; source is available in Git history at
`d5e36ba40b116e47956a9cae270fc33e8d74e514`.

The backend Firebase Callable `adminDeleteUserAccount` remains unchanged
for compatibility; it is **not** wired to the active Core account deletion UI.
Do not confuse this with an atomic, coordinated account erasure workflow.
A permanent identity-erasure operation, if needed in the future, must be
specified separately with authorization, audit, retry/reconciliation and
failure compensation across D1 and Firebase Auth.

This change does not mutate production data, Firebase users, Firestore, or D1.
