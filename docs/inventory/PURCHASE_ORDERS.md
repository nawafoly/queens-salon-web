# Inventory — purchase-order approval and physical receipt

## Lifecycle

| State | Allowed action | Balance effect |
| --- | --- | --- |
| DRAFT | Add item lines, approve or cancel | None |
| ORDERED (legacy) | Approve or cancel; lines are frozen | None |
| APPROVED | Receive one or more items; cancel only if nothing was received | None until receipt |
| PARTIAL | Receive remainder if a recorded APPROVE exists | Each actual receipt adds a movement |
| RECEIVED | Read and audit only | No further receipt |
| CANCELLED | Read and audit only | No receipt |

New orders remain **DRAFT** after each added line. Only an admin or owner
with inventory.adjust may approve or cancel; each decision requires a
3–300 character reason. The Core records the actor, timestamp and reason in
an append-only decision table. No stock movement is created by approval or
cancellation.

GET /api/core/inventory/purchase-orders/:id returns a tenant-scoped order,
its lines and decision history. Callers with only inventory.view do not
receive unit costs. POST /api/core/inventory/purchase-orders/:id/decision
accepts an APPROVE or CANCEL decision plus a reason.

Physical receipt remains POST /api/core/inventory/purchase-order-receive
with line ID, actual quantity and an explicit active destination location
selected in the UI. Legacy callers without location retain the active
default-location fallback. It is gated both by current PO status and
an existing APPROVE audit record; one atomic transaction writes exactly one
PURCHASE_RECEIPT_IN movement, increases the stock read model, updates
the line and transitions the order to PARTIAL or RECEIVED. Replaying the
same receipt operation ID does not double-credit stock.

### Legacy records

Legacy PARTIAL orders may already contain real historical receipts with
no approval history. These are not backfilled or changed silently. The UI
warns the manager, blocks further receipts, and supports explicit approval
of the **remaining** quantities. Such an approval retains the PARTIAL state
and does not duplicate previous stock movements. Already RECEIVED orders
are historical records, not reopened.

### Staging and release

Migration: migrations/core/0103_inventory_purchase_order_decisions.sql.
Apply **after** 0100–0102, **only to isolated Staging D1** for synthetic QA.
Before any Production migration, create/verify a backup, confirm existing
ORDERED/PARTIAL volumes and seek explicit release approval.

Acceptance:

- Draft with lines cannot receive; approving an empty or inactive-item order
  fails without an audit record.
- Permission gates enforce manager review on Core, not just frontend.
- Approve, cancel, retry and partial/full receipt produce correct transitions.
- Cancel after any receipt is blocked; no ledger reversal is invented.
- An old PARTIAL with no approval cannot receive until manager review.
- Cross-tenant order reads/decisions/receipts fail closed.
- Test on desktop, phone and iPad using the isolated preview and fake data.
