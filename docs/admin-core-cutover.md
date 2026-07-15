# Admin operations → Core D1 cutover

## Phase 5 scope

Migration `0004_admin_operations.sql` extends Core D1 for the admin workflows that previously depended on Firestore:

- clients, including VIP and legacy document identifiers
- service sections and category-to-section relationships
- offers and coupons, including usage counters and soft deletion
- income and expenses with legacy-compatible metadata
- refunds with idempotency, invoice balance adjustment and void history
- audit logs
- guarded booking hard deletion

The operational path is:

```text
Admin UI → queens-salon-core-api → CORE_DB
```

Firebase remains only in explicitly selected legacy branches while `VITE_USE_CORE_D1=false`. A Core D1 request failure never triggers an automatic Firestore fallback.

## Refund ledger

Refunds are first-class D1 records. Creating a refund writes the refund, its expense entry and the invoice paid-balance adjustment in one D1 batch. Editing adjusts the existing refund and invoice delta. Cancelling an administrative refund voids the record, removes its generated expense entry and restores the invoice paid balance. Refund rows are not hard-deleted.

## Booking deletion

Core D1 blocks hard deletion when a booking has a payment or refund. Safe deletion removes the booking, items, slot locks, compatible income/invoice rows and records an audit entry.

## Migration behavior

`scripts/migrate-core-firestore-to-d1.mjs` is dry-run by default and maps sections, categories, offers, discounts, income, expenses, refunds and audit logs. Explicit `*Halalas` values are preserved as halalas; Riyal fields are converted to halalas. Duplicate client phones are reported but preserved because historical client identity aliases may legitimately overlap. Duplicate active coupon codes are reported and prevented from silently overwriting each other.

## Remaining Phase 6 exceptions

The following are not part of Phase 5:

- Firebase Authentication and role/profile storage
- HR, payroll, attendance, leave and employee files
- app settings and upload/storage workflows
- the dedicated Core D1 booking reschedule endpoint
- remaining reports or screens that depend on HR/settings collections

## Verification

```bash
npm run verify:phase5
```

Do not deploy the new cutover or enable D1 feature flags until production data migration and reconciliation are complete.
