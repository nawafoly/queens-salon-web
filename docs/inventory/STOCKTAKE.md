# Inventory — location-aware physical stocktake

The stocktake workflow is an **adjustment recorded in Core D1's append-mostly
movement ledger**. It never changes a catalog item or another location's stock.

## Operator workflow

1. Select an active inventory item and an active stock location.
2. Read the current balance from `GET /api/core/inventory/stock-levels`
   with `itemId` and `locationId` filters. An item with no stock-level row is
   treated as zero; no read should create a movement.
3. Enter the actual counted quantity and a reason (3–300 characters).
4. Review the displayed variance: `countedQty - expectedQty`.
5. Confirm with `POST /api/core/inventory/stocktake`:

   ```json
   {
     "itemId": "example-item-id",
     "locationId": "example-location-id",
     "countedQty": 27,
     "expectedQty": 30,
     "note": "Counted at month end"
   }
   ```

The Core validates the tenant, active item, active location, non-negative
quantities and reason; `inventory.adjust` is still required. Missing location,
missing expected balance and missing reason are rejected. A zero variance
does not create a ledger entry.

If the stored balance differs from the reviewed balance, Core returns
`409 inventory:stocktake_stale_balance` **without writing a stocktake movement**.
The guarded ledger insert also re-checks the balance atomically in D1, so
a concurrent stock movement cannot silently be overwritten. The UI reloads
the location's current balance and requires a fresh count after this error.

## Periodic multi-item / multi-location count (separate workflow)

The **الجرد الدوري** tab records an auditable *count report*, not an adjustment:

1. Choose 1–100 unique item/location pairs and name the session. The Core
   snapshots each pair's expected quantity in its own unit.
2. Enter the counted quantity for each line. A variance requires a reason of
   3–300 characters. Counts can be revised while the session is a draft.
3. Compare the per-line variance; quantities from different units are never
   summed into one misleading total.
4. Close the report after every line has been counted. Closed reports are
   immutable and do **not** change stock levels or append ledger movements.

API endpoints: `GET/POST /api/core/inventory/stocktake-sessions`,
`GET /api/core/inventory/stocktake-sessions/:id`,
`POST /api/core/inventory/stocktake-sessions/:id/count`, and
`POST /api/core/inventory/stocktake-sessions/:id/submit`.
Writes require `inventory.adjust`; views require that permission or
`inventory.movements.view`. All records are tenant-scoped.

The report is intentionally **not** an instruction to apply its recorded
variance. If stock changed since the session's snapshot, a later adjustment
must re-read the current balance and go through the independent guarded
stocktake endpoint above.

Migration: `migrations/core/0100_inventory_stocktake_sessions.sql`.
Apply to **isolated Staging Core D1 only** for QA, after checking the target
database ID. Production migration needs an explicit separate release decision
and backup.

## Release and QA gate

- No new migration is required. The frontend and Core Worker changes must
  be tested together on **isolated Staging** before any Production release
  for the single-location adjustment workflow. Periodic sessions additionally
  require migration 0100, as described above.
- The PR Preview branch must point only to Staging Core/Firebase, not Production.
- On synthetic stock data, count one of two locations and verify only that
  location's `inventory_stock_levels` changes, with exactly one matching
  `STOCKTAKE_VARIANCE` ledger entry and the supplied reason.
- Verify increasing and decreasing balances, zero variance, stale balance,
  cross-tenant/inactive locations and missing input rejection.
- Visually test desktop, iPad and phone widths; confirm no clipped fields.
- Do not run Production D1 migrations or deploy the Production Core Worker
  as part of this PR's QA. Production release needs separate readiness review.
