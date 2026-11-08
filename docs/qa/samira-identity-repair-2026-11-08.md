# Samira canonical identity repair — verification record (2026-11-08)

Related: Draft PR #301. This document records evidence observed in operator PowerShell output. The production execution described below was explicitly approved by the owner. This record is not authorization to rerun it.

## Production read-only validation
- Account access restored via Wrangler OAuth; D1 database ID verified as `d0565103-0b29-490d-8c10-c955e8d65c4a`.
- Counts: 3 `employee_profiles`, 3 `staff`, 3 `employee_employment`; 1 active legacy account link; 1 legacy notification; 21 work schedules; 0 offboarding fences; 1 distinct profile Firebase UID.
- `staff` Firebase IDs: canonical matches profile; once-encoded legacy value is NULL; twice-encoded matches profile. This explains why only 2 of the 3 staff records match; it is not proof of new drift.
- Strict read-only preflight passed: empty canonical contact fields, matching legacy contact fields, schedules split 7/7/7 across configured periods, one legacy active account link, zero canonical active links.

## Backup and restore
- Export path (operator workstation only, **never commit this file**): `.migration-work/samira-production-20261108-145528/queens-salon-core-before-samira.sql`.
- Export size: 131245817 bytes.
- SHA-256: `DB2AE9AACC2E22067D5FD763B1A4568B72FAE6F2E052BC2CC93DC277C586F8BC`.
- Fresh export restored locally: 132 application tables, 120 triggers, 3 views; integrity check OK, foreign key check zero violations. Original export hash unchanged.

## Repair tests against fresh restored production export
- SQLite successful execution: one canonical identity in `employee_profiles`, `staff`, `employee_employment`, 21 canonical schedules, integrity and FK checks passed.
- SQLite injected failure after repair and before commit: rollback passed; original source unchanged.
- Isolated local Wrangler D1 test with repaired SQL file plus intentional invalid-JSON statement appended **after** the strict postcondition: Wrangler reported `malformed JSON: SQLITE_ERROR`.
- Subsequent independent local D1 comparison: all 132 application data tables matched the source by row fingerprints; integrity check OK; foreign key check zero violations; source database unchanged.
- Limit: the D1 rollback comparison validates application table content, **not** all schema objects or the exact execution point independently. The injected error was appended after the repair's final postcondition, and the SQL itself contains no explicit `COMMIT` statement. This is strong local evidence, but not an assertion about production behavior under every failure mode.

## Actual production execution and postconditions — 2026-11-08
- Owner approved proceeding and a final read-only preflight matched expectations: profiles=3, staff=3, employment=3, schedules=21, legacy_links=1, canonical_links=0.
- Exact repair SQL Git blob: `82ec60eb1fc294ddd16c3453df1c883667586dff`; verified locally before remote execution.
- Wrangler 4.148.0 executed `scripts/repair-samira-canonical-identity.sql` with `d1 execute queens-salon-core --remote --config wrangler.core.jsonc --file ... --yes`. Operator output: success; 15 queries, 232 rows read, 41 rows written; D1 bookmark `000067c3-00000006-0000511d-98fd07eabb6b40f1c1a5f2a3ba4b6f0d`.
- **Independent remote read-only postcondition passed**: `employee_profiles=1`, `staff=1`, `employee_employment=1`, `hr_work_schedules=21`, active canonical user link=1, canonical notification=1, legacy records across six targeted tables=0, canonical staff Firebase UID matches canonical profile UID.
- No second execution is necessary or permitted: this is a one-time repair.
- Remaining acceptance: verify actual employee login and HR/admin UI (employee list, profile, attendance and schedules) with the owner; then decide PR merge policy. SQL/data postconditions **alone** do not prove UI/login behavior.

## Release safety
- PR #301 stays Draft until release review. Production **data repair has already executed successfully**; merging the PR is a separate Git change and must not re-run SQL automatically.
- Keep the verified pre-repair backup outside Git. Do not rerun one-time SQL.

