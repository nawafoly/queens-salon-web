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

## Release and QA gate

- No new migration is required. The frontend and Core Worker changes must
  be tested together on **isolated Staging** before any Production release.
- The PR Preview branch must point only to Staging Core/Firebase, not Production.
- On synthetic stock data, count one of two locations and verify only that
  location's `inventory_stock_levels` changes, with exactly one matching
  `STOCKTAKE_VARIANCE` ledger entry and the supplied reason.
- Verify increasing and decreasing balances, zero variance, stale balance,
  cross-tenant/inactive locations and missing input rejection.
- Visually test desktop, iPad and phone widths; confirm no clipped fields.
- Do not run Production D1 migrations or deploy the Production Core Worker
  as part of this PR's QA. Production release needs separate readiness review.
