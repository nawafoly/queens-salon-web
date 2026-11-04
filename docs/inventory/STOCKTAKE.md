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
variance. Every variance line in a submitted report has a separate review:

1. Enter a 3–300 character review reason for the particular line.
2. Choose **APPLY** to accept the physical count, or **DISMISS** to record that
   the reported difference should not change stock (with a reason).
3. Send `POST /api/core/inventory/stocktake-sessions/:id/resolve` with
   `{ "lineId": "...", "decision": "APPLY", "reason": "..." }`.
   This route requires `inventory.adjust`; counts cannot be reviewed before
   the report is submitted. Lines with no variance cannot be reviewed.
4. APPLY checks the same item's location-specific balance against the frozen
   expected quantity. On success, a single D1 transaction appends exactly
   one `STOCKTAKE_VARIANCE` movement (`source_type=STOCKTAKE_SESSION`,
   `source_id=sessionId`, `line_key=lineId`), updates `inventory_stock_levels`,
   and creates a review record with the movement ID. The schema's CHECK plus
   transactional `batch()` rolls back *all* steps when a guarded step fails.
   Old counts cannot overwrite stock movements made since the snapshot.
5. DISMISS records the actor and reason with **no** stock movement. Either
   decision is immutable. Retries of the same decision are read-only; a
   conflicting decision returns 409. Both decisions remain visible in the
   report and summary.

Reviewing some lines does not implicitly approve the rest. Review one line at
a time; if stock changed, do a new physical count rather than reusing the old
number. No direct frontend writes to inventory balances are permitted.

Migrations (in order): `migrations/core/0100_inventory_stocktake_sessions.sql`
and `migrations/core/0101_inventory_stocktake_line_resolutions.sql`.
Apply to **isolated Staging Core D1 only** for QA, after checking the target
database ID. Production migration needs an explicit separate release decision
and backup.

## Release and QA gate

- The original location-specific adjustment needs no new migration. The
  periodic workflow needs migrations 0100 and 0101. The frontend and Core
  Worker must be tested together on **isolated Staging** before Production.
- The PR Preview branch must point only to Staging Core/Firebase, not Production.
- On synthetic stock data, count one of two locations and verify only that
  location's `inventory_stock_levels` changes, with exactly one matching
  `STOCKTAKE_VARIANCE` ledger entry and the supplied reason.
- Verify increasing and decreasing balances, zero variance, stale balance,
  cross-tenant/inactive locations and missing input rejection.
- For periodic review, test APPLY/DISMISS, idempotent retry, conflicting
  decisions, concurrent balance changes and rollback with no orphan ledger row;
  confirm actor/reason and movement linkage in the report.
- Visually test desktop, iPad and phone widths; confirm no clipped fields.
- Do not run Production D1 migrations or deploy the Production Core Worker
  as part of this PR's QA. Production release needs separate readiness review.
