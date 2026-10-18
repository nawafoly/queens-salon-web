# Permanent admin account deletion frontend shim retirement

The prior `src/services/adminAccountDeletionService.ts` exported
`deleteAdminAccountPermanently`, first deleting a Core admin profile and then
calling Firebase Function `adminDeleteUserAccount`. Repository search and
direct examination of the live account settings page found no consumer of
this permanent-deletion frontend method.

The active `SettingsUsers.tsx` **logical deletion** uses
`CoreAccountService.remove(account.id)` and explicitly does not remove
Firebase Auth identities. This behavior is unchanged. The backend
Firebase callable in `functions/src/index.ts` remains present and is not
deployed or modified.

The retired frontend shim is available for historical inspection at Git
commit `d5e36ba40b116e47956a9cae270fc33e8d74e514`. Do not reintroduce the two-step permanent deletion without
a separate security review, idempotency policy and partial-failure recovery
plan spanning Core and Firebase Auth.

No D1, Firestore, Firebase Auth, Cloudflare or R2 data changes are performed.
