# Administrative account deletion — runtime boundary

## Operational account deletion

The **live** management UI `src/pages/settings/SettingsUsers.tsx` calls
`CoreAccountService.remove(account.id)`, which performs a DELETE request to
`/api/admin/accounts/:id`. The Core accounts repository implements this
as `status: 'deleted'` (logical deletion), with owner protection and last-owner
checks. The UI expressly informs the operator that Firebase identity persists.
This is **not** a permanent identity deletion.

## Retired client helper

`src/services/adminAccountDeletionService.ts` had no runtime import anywhere
in the `src/` tree. It attempted two separately committed cross-system writes:
first deleting the Core admin profile/role, and then calling the Firebase
Function to delete Auth and Firestore user metadata. If the second operation
failed, partial cross-system state was possible. It is removed rather than
offering a second, unsupported deletion path. It can be inspected in Git
history at commit `d5e36ba40b116e47956a9cae270fc33e8d74e514`.

## Preserved identity capability

`functions/src/index.ts` still exports `adminDeleteUserAccount`.
Its authenticated, privileged, server-side Firebase Auth and Firestore account
document deletion semantics are **not** equivalent to the Core logical delete.
Do not remove the callable merely because the retired frontend helper was its
only in-repository client; deployed or external clients are not proven absent.

A future **permanent account deletion** workflow needs a separate design,
including explicit permissions, idempotency, retry/reconciliation, audit and
cross-system failure handling, plus testing against the currently deployed
callable before making it available in the UI.

No Production D1, Firebase, R2, or Cloudflare data were changed by this
source-only cleanup.
