# Retired orphan permanent admin account deletion shim

The former frontend module `src/services/adminAccountDeletionService.ts` exported
`deleteAdminAccountPermanently`, which sequentially deleted a Core D1 admin
profile before invoking Firebase Callable `adminDeleteUserAccount`.
Repository searches found no consumers, including direct inspection of the
large SettingsUsers, DashboardEmployees, DashboardAdminProfile and App pages.

## Operational ownership retained

- `src/pages/settings/SettingsUsers.tsx` keeps using
  `CoreAccountService.remove(account.id)` for the **logical account
  deletion** currently offered in settings. Its disable, restore, account
  linking and password-reset actions are unchanged.
- The backend Firebase Callable `adminDeleteUserAccount`, Firebase Auth, and
  Core account APIs are not removed, redeployed or executed.
- This deletion only eliminates an unreachable frontend sequence that could
  otherwise imply inconsistent cross-system cleanup if reactivated without
  an orchestration protocol.

The retired source can be inspected in Git history at
`d5e36ba40b116e47956a9cae270fc33e8d74e514`.
Reintroducing **permanent** deletion needs separate cross-system rollback,
authorization and consistency design. No Production D1 or Firebase data
mutation occurs in this cleanup.
